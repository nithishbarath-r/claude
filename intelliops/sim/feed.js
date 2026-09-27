// The live sensor feed: stands in for the logger vendor API and transport telemetry.
// On each tick it advances every in-transit consignment to the clock's `now` and writes readings.

const cds = require('@sap/cds')
const { advance, STEP, noise } = require('./physics')
const { ROUTES, plannedLegs, dwellFactor, facilities: masterFacilities } = require('./master')
const MASTER = Object.fromEntries(masterFacilities().map(f => [f.code, f]))

class Feed {
  async load (db) {
    const m = cds.entities('intelliops')
    this.db = db
    const live = await db.run(SELECT.from(m.Consignments).where({ status: 'IN_TRANSIT' }))
    const ids = live.map(c => c.ID)
    const legs = ids.length ? await db.run(SELECT.from(m.Legs).where({ consignment_ID: { in: ids } }).orderBy('seq')) : []
    const faults = await db.run(SELECT.from(m.SimFaults))
    const last = await db.run(`SELECT r.consignment_ID, r.at, r.tempC, r.km, r.moving, r.legSeq FROM intelliops_Readings r
      JOIN (SELECT consignment_ID, max(at) AS m FROM intelliops_Readings GROUP BY consignment_ID) x
      ON x.consignment_ID = r.consignment_ID AND x.m = r.at`)
    this.lastReading = new Map(last.map(r => [r.consignment_ID, { ...r, tempC: Number(r.tempC), km: Number(r.km) }]))
    this.faults = faults.map(f => ({ ...f, params: JSON.parse(f.params || '{}') }))
    this.live = live.map(c => ({
      ...c,
      legs: legs.filter(l => l.consignment_ID === c.ID),
      lastAt: this.lastReading.get(c.ID) ? Date.parse(this.lastReading.get(c.ID).at) : Date.parse(c.departedAt) - STEP
    }))
    this.products = Object.fromEntries((await db.run(SELECT.from(m.Products))).map(p => [p.ID, p]))
    this.facilities = Object.fromEntries((await db.run(SELECT.from(m.Facilities))).map(f => [f.ID, f]))
    const refs = (await db.run(SELECT.from(m.Consignments).columns('ref'))).filter(r => r.ref.startsWith('CNS-'))
    this.nextRef = Math.max(1000, ...refs.map(r => Number(r.ref.slice(4)))) + 1
    return this
  }

  faultsFor (id) { return this.faults.filter(f => f.consignment_ID === id) }

  async step (now) {
    const m = cds.entities('intelliops')
    const all = [], legUpdates = [], delivered = []
    for (const c of this.live) {
      const before = JSON.stringify(c.legs)
      const faults = this.faultsFor(c.ID)
      const endsBefore = faults.map(f => f.endAt)
      const rs = advance(c, faults, now)
      all.push(...rs)
      if (rs.length) this.lastReading.set(c.ID, rs.at(-1))
      if (JSON.stringify(c.legs) !== before) legUpdates.push(...c.legs)
      faults.forEach((f, i) => { if (f.endAt !== endsBefore[i]) f._dirty = true })
      if (c.status === 'DELIVERED') delivered.push(c)
    }
    for (let i = 0; i < all.length; i += 5000) await this.db.run(INSERT.into(m.Readings).entries(all.slice(i, i + 5000)))
    for (const l of legUpdates) await this.db.run(UPDATE(m.Legs, l.ID).with({ enteredAt: l.enteredAt, exitedAt: l.exitedAt, movedMins: l.movedMins, simActualMins: l.simActualMins }))
    for (const f of this.faults.filter(f => f._dirty)) { delete f._dirty; await this.db.run(UPDATE(m.SimFaults, f.ID).with({ endAt: f.endAt, params: JSON.stringify(f.params) })) }
    for (const c of delivered) await this.db.run(UPDATE(m.Consignments, c.ID).with({ status: 'DELIVERED' }))
    this.live = this.live.filter(c => c.status === 'IN_TRANSIT')
    // the dispatch plan keeps running: each delivery frees a vehicle for the next run on its route
    for (const c of delivered) await this.spawnFollowOn(c, now)
    return { readings: all.length, delivered: delivered.map(c => c.ref) }
  }

  async spawnFollowOn (prev, now) {
    const m = cds.entities('intelliops')
    const route = ROUTES.find(r => r.code === prev.route)
    const dest = this.facilities[prev.destination_ID], product = this.products[prev.product_ID]
    const depAt = prev.legs.at(-1).exitedAt
    const ID = cds.utils.uuid(), ref = `CNS-${this.nextRef++}`
    const legs = plannedLegs(route, MASTER[dest.code]?.kmFromDS ?? 30).map((l, seq) => {
      const travel = l.kind === 'LONGHAUL' || l.kind === 'LASTMILE'
      const f = travel ? 1 + 0.06 * noise(ID, seq) : dwellFactor(route, l.kind) * (1 + 0.25 * noise(ID, seq))
      return { ID: cds.utils.uuid(), consignment_ID: ID, seq, kind: l.kind, km: l.km, plannedMins: l.plannedMins, simActualMins: Math.max(10, Math.round(l.plannedMins * f)),
        movedMins: 0, enteredAt: seq === 0 ? depAt : null, exitedAt: null, fromFac_ID: prev.origin_ID, toFac_ID: prev.destination_ID }
    })
    const promisedAt = new Date(Date.parse(depAt) + (legs.reduce((a, l) => a + l.plannedMins, 0) + 60) * 60000).toISOString()
    const q = SELECT.from(m.Sessions).columns('ID', 'dosesRequired', 'sessionDate', 'facility_ID').where({ antigen: product.code, sessionDate: { '>': promisedAt } }).orderBy('sessionDate')
    let sessions = await this.db.run(q)
    sessions = route.kind === 'LONGHAUL'
      ? sessions.filter(s => this.facilities[s.facility_ID].district === dest.district && Date.parse(s.sessionDate) < Date.parse(promisedAt) + 10 * 86400000)
      : sessions.filter(s => s.facility_ID === dest.ID).slice(0, 2)
    const c = { ID, ref, product_ID: prev.product_ID, batch: prev.batch, doses: prev.doses, origin_ID: prev.origin_ID, destination_ID: prev.destination_ID,
      route: prev.route, carrier: prev.carrier, vehicle: prev.vehicle, departedAt: depAt, promisedAt, status: 'IN_TRANSIT' }
    await this.db.run(INSERT.into(m.Consignments).entries(c))
    await this.db.run(INSERT.into(m.Legs).entries(legs))
    if (sessions.length) await this.db.run(INSERT.into(m.Serves).entries(sessions.map(s => ({ ID: cds.utils.uuid(), consignment_ID: ID, session_ID: s.ID, doses: s.dosesRequired }))))
    const next = { ...c, legs, lastAt: Date.parse(depAt) - STEP }
    // catch its telemetry up in the same tick, so it never looks dark to the agents
    const rs = advance(next, [], now)
    if (rs.length) { await this.db.run(INSERT.into(m.Readings).entries(rs)); this.lastReading.set(ID, rs.at(-1)) }
    for (const l of legs) await this.db.run(UPDATE(m.Legs, l.ID).with({ enteredAt: l.enteredAt, exitedAt: l.exitedAt, movedMins: l.movedMins }))
    this.live.push(next)
  }

  async addFault (f) {
    const m = cds.entities('intelliops')
    const row = { ID: cds.utils.uuid(), endAt: null, ...f }
    await this.db.run(INSERT.into(m.SimFaults).entries({ ...row, params: JSON.stringify(row.params) }))
    this.faults.push(row)
    return row
  }

  async updateFault (f) {
    const m = cds.entities('intelliops')
    await this.db.run(UPDATE(m.SimFaults, f.ID).with({ endAt: f.endAt, params: JSON.stringify(f.params) }))
  }

  async setStatus (c, status) {
    const m = cds.entities('intelliops')
    c.status = status
    await this.db.run(UPDATE(m.Consignments, c.ID).with({ status }))
    this.live = this.live.filter(x => x.status === 'IN_TRANSIT')
  }

  async updateLeg (l) {
    const m = cds.entities('intelliops')
    await this.db.run(UPDATE(m.Legs, l.ID).with({ simActualMins: l.simActualMins }))
  }
}

module.exports = { Feed }
