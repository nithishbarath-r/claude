// Generates the world: master data, 180 days of history (the learning set),
// the learned dwell models and route memory, and 200 live consignments.
//
//   node sim/generate.js --reset
//
// Seeded — the same world every time, so the demo is repeatable.

const cds = require('@sap/cds')
const { PRODUCTS, DISTRICTS, ROUTES, facilities, plannedLegs, dwellFactor } = require('./master')
const { advance, STEP } = require('./physics')
const clock = require('../srv/lib/clock')

const DAY = 86400000
const LIVE_COUNT = 200
const HISTORY_COUNT = 600
const HISTORY_DAYS = 180 // long enough for the April–June seasonal pattern to be in memory
const HERO_REF = 'CNS-1042'

function rng (seed) {
  let a = seed >>> 0
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const r = {
    next,
    between: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: xs => xs[Math.floor(next() * xs.length)],
    chance: p => next() < p,
    lognormal: sigma => { const u = next() || 1e-9, v = next(); return Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)) }
  }
  return r
}

const iso = t => new Date(t).toISOString()
const uuid = () => cds.utils.uuid()
const istHour = t => new Date(t + 5.5 * 3600000).getUTCHours()
const istDate = t => new Date(t).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })

// ---------------------------------------------------------------------------

async function generate (db, { seed = 7 } = {}) {
  const R = rng(seed)
  const now = clock.ANCHOR
  const m = cds.entities('intelliops')
  const t0 = Date.now()

  for (const e of ['Ledger', 'Options', 'Escalations', 'Signals', 'SimFaults', 'BatchHolds', 'Readings', 'Serves', 'Legs',
    'Consignments', 'Sessions', 'RouteMemory', 'DwellModels', 'Facilities', 'Products']) await db.run(DELETE.from(m[e]))

  // --- master data ---------------------------------------------------------
  const products = PRODUCTS.map(p => ({ ID: uuid(), ...p }))
  const prodBy = Object.fromEntries(products.map(p => [p.code, p]))
  const facs = facilities().map(f => ({ ID: uuid(), ...f }))
  const facBy = Object.fromEntries(facs.map(f => [f.code, f]))
  await db.run(INSERT.into(m.Products).entries(products))
  await db.run(INSERT.into(m.Facilities).entries(facs.map(({ sessionDay, children, kmFromDS, ...f }) => f)))

  // last-mile clusters: split a district's PHCs (and its hospital) in two
  const cluster = (d, i) => facs.filter(f => f.district === DISTRICTS[d].name && (f.kind === 'PHC' || f.kind === 'HOSPITAL'))
    .filter((f, k) => k % 2 === i)

  // --- sessions: ~200 over the next three weeks --------------------------
  const sessions = []
  const rotation = ['MR', 'RVV', 'HEPB']
  const startDay = Date.parse('2026-09-30T00:00:00+05:30')
  for (const f of facs.filter(f => f.sessionDay)) {
    for (let d = 0; d < 21; d++) {
      const day = startDay + d * DAY
      if (new Date(day + 5.5 * 3600000).getUTCDay() !== f.sessionDay) continue
      const at = day + 9.5 * 3600000 // 09:30 IST
      const week = Math.floor(d / 7)
      for (const antigen of ['PENTA', rotation[(week + f.children) % 3]]) {
        sessions.push({ ID: uuid(), facility_ID: f.ID, sessionDate: iso(at), antigen, expectedChildren: f.children,
          dosesRequired: Math.ceil(f.children * 1.25 / 10) * 10, _fac: f, _at: at })
      }
    }
  }
  await db.run(INSERT.into(m.Sessions).entries(sessions.map(({ _fac, _at, ...s }) => s)))

  // --- history: the learning set -----------------------------------------
  const refNo = { n: 1000 }
  const nextRef = () => { let r; do r = `CNS-${refNo.n++}`; while (r === HERO_REF); return r }
  const histLegs = [], histCons = [], memory = []
  const lh = ROUTES.filter(r => r.kind === 'LONGHAUL'), lm = ROUTES.filter(r => r.kind === 'LASTMILE')
  for (let i = 0; i < HISTORY_COUNT; i++) {
    let route = R.chance(0.3) ? R.pick(lh) : R.pick(lm)
    while (route.newRoute && R.chance(0.88)) route = R.pick(lm) // only a few trips so far
    const span = route.newRoute ? 21 : HISTORY_DAYS
    const dep = now - 2 * DAY - R.between(0, span) * DAY
    const dest = route.kind === 'LONGHAUL' ? facBy[`DS-${route.district}`] : R.pick(cluster(route.district, route.cluster))
    const origin = route.kind === 'LONGHAUL' ? facBy['SS-CHN'] : facBy[`DS-${route.district}`]
    const c = { ID: uuid(), ref: `H-${i + 1}`, product_ID: R.pick(products).ID, batch: `B-H${R.int(10000, 99999)}`, doses: 1000,
      origin_ID: origin.ID, destination_ID: dest.ID, route: route.code, carrier: route.carrier || 'District vaccine van',
      departedAt: iso(dep), status: 'DELIVERED' }
    let t = dep
    plannedLegs(route, dest.kmFromDS).forEach((l, seq) => {
      const travel = l.kind === 'LONGHAUL' || l.kind === 'LASTMILE'
      const actual = Math.round(l.plannedMins * (travel ? R.lognormal(0.08) : dwellFactor(route, l.kind) * R.lognormal(0.3)))
      histLegs.push({ ID: uuid(), consignment_ID: c.ID, seq, kind: l.kind, km: l.km, plannedMins: l.plannedMins,
        enteredAt: iso(t), exitedAt: iso(t + actual * 60000), movedMins: travel ? actual : 0, simActualMins: actual })
      t += actual * 60000
    })
    c.promisedAt = iso(t)
    histCons.push(c)

    // disruption fingerprints for route memory
    const month = new Date(dep).getUTCMonth() // 3..5 = April–June
    const seasonal = route.code === 'CHN-TVL' && month >= 3 && month <= 5
    const hour = R.int(0, 23)
    if ((seasonal && R.chance(0.5)) || R.chance(0.05)) {
      const kind = seasonal ? 'HEAT' : R.pick(['HEAT', 'HEAT', 'HEAT', 'DWELL', 'FREEZE', 'SILENT_STALL'])
      const legKind = kind === 'DWELL' ? 'HANDOVER' : (route.kind === 'LONGHAUL' ? 'LONGHAUL' : 'LASTMILE')
      const peak = kind === 'FREEZE' ? R.between(-3, 1.5) : R.between(8.4, 12.5)
      const mins = R.int(20, 160)
      const action = kind === 'FREEZE' ? 'REALLOCATE' : R.pick(['DIVERT', 'DIVERT', 'REICE', 'EXPEDITE', 'NONE'])
      const pSaved = { DIVERT: 0.82, REICE: 0.74, EXPEDITE: 0.6, REALLOCATE: 0.7, NONE: 0.3 }[action] * (mins > 100 ? 0.7 : 1)
      const outcome = kind === 'FREEZE' ? 'LOST' : (R.chance(pSaved) ? 'SAVED' : 'LOST')
      const h = seasonal ? R.int(13, 17) : hour
      memory.push({ ID: uuid(), route: route.code, legKind, at: iso(dep), kind, peakTempC: Math.round(peak * 10) / 10,
        minutesOut: mins, hourOfDay: h, action, outcome,
        summary: `${istDate(dep)}, ${route.code} ${legKind.toLowerCase()}, ${kind === 'DWELL' ? `${mins} min dwell` : `${peak.toFixed(1)}°C for ${mins} min`} at ${String(h).padStart(2, '0')}:00 — ${action === 'NONE' ? 'no action' : action.toLowerCase()}, batch ${outcome.toLowerCase()}` })
    }
  }
  await db.run(INSERT.into(m.Consignments).entries(histCons))
  await db.run(INSERT.into(m.Legs).entries(histLegs))
  await db.run(INSERT.into(m.RouteMemory).entries(memory))

  // --- learned dwell models ----------------------------------------------
  const models = []
  for (const route of ROUTES) {
    const ids = new Set(histCons.filter(c => c.route === route.code).map(c => c.ID))
    const planned = plannedLegs(route, 30)
    for (const kind of ['DISPATCH', 'LONGHAUL', 'LASTMILE', 'HANDOVER']) {
      const p = planned.find(l => l.kind === kind)
      if (!p) continue
      const xs = histLegs.filter(l => ids.has(l.consignment_ID) && l.kind === kind).map(l => l.simActualMins).sort((a, b) => a - b)
      if (xs.length >= 30) {
        const q = f => xs[Math.min(xs.length - 1, Math.floor(f * xs.length))]
        const mean = xs.reduce((a, b) => a + b, 0) / xs.length
        const sigma = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
        models.push({ ID: uuid(), route: route.code, legKind: kind, medianMins: q(0.5), p95Mins: q(0.95), sigmaMins: Math.round(sigma), samples: xs.length, mode: 'LEARNED' })
      } else {
        models.push({ ID: uuid(), route: route.code, legKind: kind, medianMins: p.plannedMins, p95Mins: Math.round(p.plannedMins * 1.5), sigmaMins: Math.round(p.plannedMins * 0.25), samples: xs.length, mode: 'PLANNED' })
      }
    }
  }
  await db.run(INSERT.into(m.DwellModels).entries(models))

  // --- live consignments --------------------------------------------------
  const live = []
  const batchOf = (p, d) => `B-${String(10000 + ((p.code.charCodeAt(0) * 131 + d.charCodeAt(0) * 17 + d.charCodeAt(2) * 7) % 89999)).slice(0, 5)}`
  const plates = () => `TN-${String(R.int(1, 99)).padStart(2, '0')}-${String.fromCharCode(65 + R.int(0, 25), 65 + R.int(0, 25))}-${R.int(1000, 9999)}`

  function makeLive (route, opts = {}) {
    const d = route.district
    const dest = opts.dest || (route.kind === 'LONGHAUL' ? facBy[`DS-${d}`] : R.pick(cluster(d, route.cluster)))
    const origin = route.kind === 'LONGHAUL' ? facBy['SS-CHN'] : facBy[`DS-${d}`]
    let product = opts.product
    if (!product && route.kind === 'LASTMILE') {
      // send what the PHC's next session needs
      const next = sessions.filter(s => s._fac.ID === dest.ID && s._at > now).sort((a, b) => a._at - b._at)
      product = prodBy[next.length ? R.pick(next.filter(s => s._at === next[0]._at)).antigen : 'PENTA']
    }
    product = product || R.pick(products)

    const legs = plannedLegs(route, dest.kmFromDS).map((l, seq) => {
      const travel = l.kind === 'LONGHAUL' || l.kind === 'LASTMILE'
      const actual = Math.max(10, Math.round(l.plannedMins * (travel ? R.lognormal(0.06) : dwellFactor(route, l.kind) * R.lognormal(0.25))))
      return { ID: uuid(), seq, kind: l.kind, km: l.km, plannedMins: l.plannedMins, simActualMins: actual, movedMins: 0,
        fromFac_ID: seq === 0 ? origin.ID : (l.kind === 'HANDOVER' ? dest.ID : origin.ID), toFac_ID: dest.ID }
    })
    const total = legs.reduce((a, l) => a + l.simActualMins, 0)
    const dep = opts.departedAt || now - Math.round(R.between(0.03, 0.9) * total) * 60000
    const plannedTotal = legs.reduce((a, l) => a + l.plannedMins, 0)
    const c = { ID: uuid(), ref: opts.ref || nextRef(), product_ID: product.ID, batch: opts.batch || `${batchOf(product, d)}${R.int(1, 5)}`,
      doses: 0, origin_ID: origin.ID, destination_ID: dest.ID, route: route.code, carrier: route.carrier || 'District vaccine van',
      vehicle: opts.vehicle || plates(), departedAt: iso(dep), promisedAt: iso(dep + (plannedTotal + 60) * 60000), status: 'IN_TRANSIT',
      legs, _route: route, _product: product, _dest: dest }

    // which sessions depend on it
    const promised = Date.parse(c.promisedAt)
    const served = route.kind === 'LONGHAUL'
      ? sessions.filter(s => s.antigen === product.code && s._fac.district === DISTRICTS[d].name && s._at > promised && s._at < promised + 10 * DAY)
      : sessions.filter(s => s.antigen === product.code && s._fac.ID === dest.ID && s._at > promised).sort((a, b) => a._at - b._at).slice(0, 2)
    c.serves = served.map(s => ({ ID: uuid(), consignment_ID: c.ID, session_ID: s.ID, doses: s.dosesRequired }))
    const committed = c.serves.reduce((a, s) => a + s.doses, 0)
    c.doses = opts.doses || (route.kind === 'LONGHAUL' ? Math.max(committed, R.int(12, 30) * 500) : Math.ceil(committed * 1.1 / 50) * 50 || 200)
    live.push(c)
    return c
  }

  // the hero of the demo: 12,000 doses of pentavalent to Madurai, 335 minutes into the long haul
  const heroRoute = ROUTES.find(r => r.code === 'CHN-MDU')
  const hero = makeLive(heroRoute, { ref: HERO_REF, product: prodBy.PENTA, doses: 12000, batch: 'B-77213', vehicle: 'TN-07-AK-4417',
    departedAt: now - (45 + 335) * 60000 })
  hero.legs[0].simActualMins = 45; hero.legs[1].simActualMins = hero.legs[1].plannedMins; hero.legs[2].simActualMins = 80

  let lhCount = 1
  while (live.length < LIVE_COUNT) {
    const route = lhCount < 40 ? lh[lhCount % lh.length] : lm[live.length % lm.length]
    if (lhCount < 40) lhCount++
    makeLive(route)
  }

  // --- a handful already mildly interesting, before any injection --------
  const faults = []
  const fault = (c, kind, startMinsAgo, params) => faults.push({ ID: uuid(), consignment_ID: c.ID, kind, startAt: iso(now - startMinsAgo * 60000), endAt: null, params })
  const pickLive = pred => live.find(c => c.ref !== HERO_REF && !faults.some(f => f.consignment_ID === c.ID) && pred(c))
  // simulate where each consignment will be at `now` without faults, to choose honestly
  const positionAt = c => { let t = Date.parse(c.departedAt); for (const l of c.legs) { if (t + l.simActualMins * 60000 > now) return { leg: l, into: (now - t) / 60000, left: (t + l.simActualMins * 60000 - now) / 60000 }; t += l.simActualMins * 60000 } return null }
  const unbufferedSoon = c => c.serves.some(s => { const ss = sessions.find(x => x.ID === s.session_ID); return ss._fac.bufferDoses < s.doses && ss._at < Date.parse(c.promisedAt) + 2 * DAY })

  // 1. weak reefer on the slow carrier's corridor, hours still to run
  const weak = pickLive(c => c.route === 'CHN-CBE' && positionAt(c)?.leg.kind === 'LONGHAUL' && positionAt(c).left > 240 && unbufferedSoon(c))
    || pickLive(c => c._route.kind === 'LONGHAUL' && positionAt(c)?.leg.kind === 'LONGHAUL' && positionAt(c).left > 240 && unbufferedSoon(c))
  if (weak) fault(weak, 'HEAT', 90, { Ta: 16, tau: 150, endOnArrival: true, label: 'reefer compressor short-cycling' })
  // 2. goods receipt stuck at the slow district store, dock doors open
  const dock = pickLive(c => c.route === 'CHN-TRY' && positionAt(c)?.leg.kind === 'HANDOVER' && positionAt(c).into > 60)
  if (dock) {
    const into = Math.round(positionAt(dock).into)
    dock.legs[2].simActualMins = into + 300
    fault(dock, 'HEAT', into - 10, { Ta: 10.5, tau: 45, label: 'pallet left on an open receiving dock' })
  }
  // 3. a vaccine carrier whose ice packs were not conditioned
  const box = pickLive(c => c._route.kind === 'LASTMILE' && positionAt(c)?.leg.kind === 'LASTMILE' && positionAt(c).left > 40 && unbufferedSoon(c) && c._product.code === 'MR')
    || pickLive(c => c._route.kind === 'LASTMILE' && positionAt(c)?.leg.kind === 'LASTMILE' && positionAt(c).left > 40 && unbufferedSoon(c))
  if (box) fault(box, 'HEAT', 30, { Ta: 19, tau: 90, endOnArrival: true, label: 'ice packs not conditioned' })
  // 4. stuck at the state store's dispatch dock, doors open
  const disp = pickLive(c => c._route.kind === 'LONGHAUL' && positionAt(c)?.leg.kind === 'DISPATCH' && positionAt(c).into > 20 && unbufferedSoon(c))
  if (disp) {
    const into = Math.round(positionAt(disp).into)
    disp.legs[0].simActualMins = into + 240
    fault(disp, 'HEAT', into - 5, { Ta: 11.5, tau: 35, label: 'loaded pallet waiting on an open dispatch dock' })
  }
  // background: warm-ish readings that should be logged, never escalated
  for (let i = 0; i < 5; i++) {
    const c = pickLive(c => c._route.kind === 'LASTMILE' && positionAt(c)?.leg.kind === 'LASTMILE' && positionAt(c).left < 45)
    if (c) fault(c, 'HEAT', R.int(25, 40), { Ta: 9.3, tau: 12, endOnArrival: true, label: 'door opened at a checkpoint' })
  }

  // --- backfill telemetry up to now ---------------------------------------
  const readings = []
  for (const c of live) {
    c.lastAt = Date.parse(c.departedAt) - STEP
    c.legs[0].enteredAt = c.departedAt
    readings.push(...advance(c, faults.filter(f => f.consignment_ID === c.ID), now))
  }
  const liveNow = live.filter(c => c.status === 'IN_TRANSIT')

  await db.run(INSERT.into(m.Consignments).entries(live.map(({ legs, serves, lastAt, _route, _product, _dest, ...c }) => c)))
  await db.run(INSERT.into(m.Legs).entries(live.flatMap(c => c.legs.map(l => ({ ...l, consignment_ID: c.ID })))))
  await db.run(INSERT.into(m.Serves).entries(live.flatMap(c => c.serves)))
  for (let i = 0; i < readings.length; i += 5000) await db.run(INSERT.into(m.Readings).entries(readings.slice(i, i + 5000)))
  if (faults.length) await db.run(INSERT.into(m.SimFaults).entries(faults.map(f => ({ ...f, params: JSON.stringify(f.params) }))))

  try { await db.run('CREATE INDEX IF NOT EXISTS readings_by_consignment ON intelliops_Readings (consignment_ID, at)') } catch { /* HANA: use a proper index definition */ }

  return {
    ms: Date.now() - t0, facilities: facs.length, sessions: sessions.length, history: histCons.length,
    memory: memory.length, models: models.length, learned: models.filter(x => x.mode === 'LEARNED').length,
    live: liveNow.length, readings: readings.length, planted: faults.length
  }
}

module.exports = { generate, HERO_REF }

if (require.main === module) {
  (async () => {
    const fs = require('fs'), path = require('path')
    process.chdir(path.join(__dirname, '..'))
    const reset = process.argv.includes('--reset')
    const file = cds.env.requires.db.credentials.url
    if (reset && fs.existsSync(file)) fs.unlinkSync(file)
    const db = await cds.connect.to('db')
    const csn = await cds.load('*')
    cds.model = cds.compile.for.nodejs(csn)
    if (reset) await cds.deploy(csn).to(db)
    const stats = await generate(db)
    console.log('world generated', stats)
    await db.disconnect?.()
  })().catch(e => { console.error(e); process.exit(1) })
}
