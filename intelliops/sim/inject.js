// The five demo injectors. Each one injects a CAUSE into the simulated world and lets the
// tick do the rest — nothing here writes a signal, a forecast or an escalation.

const cds = require('@sap/cds')
const { ROUTES } = require('./master')
const HERO_REF = 'CNS-1042'

const iso = t => new Date(t).toISOString()
const currentLeg = c => c.legs.find(l => !l.exitedAt)
const travelling = c => ['LONGHAUL', 'LASTMILE'].includes(currentLeg(c)?.kind)
const routeOf = c => ROUTES.find(r => r.code === c.route)
const leftMins = c => { const l = currentLeg(c); return l ? l.simActualMins - (['LONGHAUL', 'LASTMILE'].includes(l.kind) ? (l.movedMins || 0) : 0) : 0 }

const KINDS = {
  HEAT: {
    label: 'Heat excursion',
    what: 'Reefer failure on a stationary vehicle',
    eligible: c => travelling(c) && routeOf(c).kind === 'LONGHAUL' && leftMins(c) > 150,
    prefer: c => c.ref === HERO_REF
  },
  STALL: {
    label: 'Silent stall',
    what: 'The logger stops reporting and the vehicle stops moving',
    eligible: c => travelling(c) && leftMins(c) > 40 && c.ref !== HERO_REF,
    prefer: c => routeOf(c).kind === 'LASTMILE'
  },
  FREEZE: {
    label: 'Freeze',
    what: 'A short dip below 0°C from an overcooling reefer, then back to normal',
    eligible: (c, p) => travelling(c) && p.freezeSensitive && c.ref !== HERO_REF && leftMins(c) > 30,
    prefer: c => routeOf(c).kind === 'LONGHAUL'
  },
  HOLD: {
    label: 'Quality hold',
    what: 'Supplier recall notice puts a batch on hold at a district store',
    eligible: c => c.ref !== HERO_REF
  },
  NOGOOD: {
    label: 'No good option',
    what: 'Vaccine carrier left in direct sun, late on a remote single-source run',
    eligible: c => currentLeg(c)?.kind === 'LASTMILE' && routeOf(c).district === 'TVL' && (currentLeg(c).movedMins || 0) >= 40 && leftMins(c) >= 55,
    prefer: (c, p) => p.budgetMinutesAbove <= 240 // the heat-fragile antigens
  }
}

async function candidates (feed, db, kind) {
  const m = cds.entities('intelliops')
  const products = Object.fromEntries((await db.run(SELECT.from(m.Products))).map(p => [p.ID, p]))
  const k = KINDS[kind]
  // sessions that depend on a candidate and are not covered by buffer — so the demo target matters to someone
  const serves = await db.run(SELECT.from(m.Serves).columns(s => { s.consignment_ID, s.doses, s.session(x => { x.sessionDate, x.facility(f => { f.bufferDoses }) }) }))
  const promised = Object.fromEntries(feed.live.map(c => [c.ID, Date.parse(c.promisedAt)]))
  const exposed = new Set(serves.filter(s => s.session.facility.bufferDoses < s.doses && Date.parse(s.session.sessionDate) < (promised[s.consignment_ID] || 0) + 48 * 3600000).map(s => s.consignment_ID))
  const faulted = new Set(feed.faults.map(f => f.consignment_ID))
  let list = feed.live.filter(c => !faulted.has(c.ID) && k.eligible(c, products[c.product_ID]))
  if (kind === 'HOLD') {
    const counts = {}
    for (const c of feed.live) counts[c.batch] = (counts[c.batch] || 0) + 1
    list = list.filter(c => counts[c.batch] >= 3).sort((a, b) => counts[b.batch] - counts[a.batch])
  }
  const score = c => 100 * Number(kind === 'HEAT' && c.ref === HERO_REF) + 10 * Number(exposed.has(c.ID)) + 5 * Number(!!k.prefer?.(c, products[c.product_ID]))
  list.sort((a, b) => score(b) - score(a))
  return list.slice(0, 15).map(c => ({ ref: c.ref, route: c.route, product: products[c.product_ID].code, batch: c.batch, leg: currentLeg(c)?.kind, exposed: exposed.has(c.ID) }))
}

async function inject (feed, db, kind, ref, now) {
  const m = cds.entities('intelliops')
  const list = await candidates(feed, db, kind)
  const target = feed.live.find(c => c.ref === (ref || list[0]?.ref))
  if (!target) throw new Error(`No eligible consignment for ${kind}${ref ? ` (${ref})` : ''}`)
  const at = iso(now)
  const add = (c, k, params) => feed.addFault({ consignment_ID: c.ID, kind: k, startAt: at, params })
  const done = [`${KINDS[kind].label} → ${target.ref}`]

  switch (kind) {
    case 'HEAT': {
      await add(target, 'HEAT', { Ta: 32, tau: 240, stationary: true, endOnArrival: true, label: 'reefer failure at an unscheduled stop' })
      // the same afternoon heat touches three others that are nearly home — they must NOT escalate
      const near = feed.live.filter(c => c !== target && travelling(c) && leftMins(c) > 25 && leftMins(c) < 70 && !feed.faultsFor(c.ID).length).slice(0, 3)
      for (const c of near) await add(c, 'HEAT', { Ta: 13, tau: 60, endOnArrival: true, label: 'afternoon heat, door seal' })
      if (near.length) done.push(`mild heat on ${near.map(c => c.ref).join(', ')}`)
      break
    }
    case 'STALL':
      await add(target, 'STALL', { label: 'logger and vehicle both dark' })
      break
    case 'FREEZE':
      await add(target, 'FREEZE', { dipTo: -2.5, durMins: 25, label: 'reefer thermostat overcooling' })
      break
    case 'HOLD': {
      const route = routeOf(target)
      const store = await db.run(SELECT.one.from(m.Facilities).where({ code: `DS-${route.district}` }))
      await db.run(INSERT.into(m.BatchHolds).entries({ ID: cds.utils.uuid(), batch: target.batch, facility_ID: store.ID, at,
        reason: 'supplier recall notice — potency assay out of specification' }))
      done[0] = `Quality hold → batch ${target.batch} (${feed.live.filter(c => c.batch === target.batch).length} consignments in transit)`
      break
    }
    case 'NOGOOD':
      await add(target, 'HEAT', { Ta: 45, tau: 25, endOnArrival: true, label: 'vaccine carrier left in direct sun, lid open' })
      break
    default: throw new Error(`Unknown injector ${kind}`)
  }
  return done.join('; ')
}

module.exports = { inject, candidates, KINDS, HERO_REF }
