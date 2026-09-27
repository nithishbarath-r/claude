// Unit tests for the pure agent functions. Run: npm test
const { test } = require('node:test')
const assert = require('node:assert/strict')
const sensing = require('../srv/agents/sensing')
const scenario = require('../srv/agents/scenario')
const compliance = require('../srv/agents/compliance')

const T0 = Date.parse('2026-09-30T06:00:00Z')
const at = m => new Date(T0 + m * 60000).toISOString()
const series = temps => temps.map((t, i) => ({ at: at(i * 5), tempC: t, moving: true, km: i }))
const PENTA = { minTempC: 2, maxTempC: 8, freezeSensitive: true, budgetMinutesAbove: 300, budgetMinutesBelow: 5 }

test('sensing: one bad reading is an artefact, three in a row is an event', () => {
  sensing.resetDebounce()
  assert.equal(sensing.excursion({ readings: series([5, 5, 9.1, 5, 5]), product: PENTA, since: T0 - 1 }), null)
  const s = sensing.excursion({ readings: series([5, 8.4, 8.9, 9.2]), product: PENTA, since: T0 - 1 })
  assert.equal(s.direction, 'HEAT')
})

test('sensing: a freeze that already recovered is still caught, at severity 1.0', () => {
  const s = sensing.excursion({ readings: series([5, 1.2, -1.5, -0.4, 4.8, 5.2]), product: PENTA, since: T0 - 1 })
  assert.equal(s.direction, 'FREEZE')
  assert.equal(s.severity, 1.0)
})

test('sensing: silent stall fires on absence', () => {
  const c = { route: 'TVL-N', departedAt: at(0) }
  assert.equal(sensing.silentStall({ consignment: c, lastReading: { at: at(0), tempC: 5, km: 3 }, now: T0 + 20 * 60000 }), null)
  const s = sensing.silentStall({ consignment: c, lastReading: { at: at(0), tempC: 5, km: 3 }, now: T0 + 35 * 60000 })
  assert.equal(s.kind, 'SILENT_STALL')
})

test('sensing: dwell compares against the learned P95 for that route', () => {
  const leg = { kind: 'HANDOVER', enteredAt: at(0) }
  const model = { p95Mins: 150, mode: 'LEARNED', samples: 48 }
  assert.equal(sensing.dwell({ consignment: { route: 'CHN-TRY' }, leg, model, now: T0 + 140 * 60000 }), null)
  assert.equal(sensing.dwell({ consignment: { route: 'CHN-TRY' }, leg, model, now: T0 + 160 * 60000 }).mode, 'LEARNED')
})

test('scenario: freezing costs far more budget than heat', () => {
  const heat = scenario.consumedBudget(series([5, 9, 9]), PENTA)
  const cold = scenario.consumedBudget(series([5, 1, 1]), PENTA)
  assert.ok(cold.below > heat.above)
})

test('scenario: at risk only when it breaches before it arrives', () => {
  const legs = [{ kind: 'LONGHAUL', plannedMins: 60, movedMins: 50, enteredAt: at(0) }]
  const c = { route: 'X', departedAt: at(0) }
  const rising = series([5, 6, 7, 8.5, 9.5, 10.5, 11.5])
  const now = Date.parse(rising.at(-1).at)
  const near = scenario.project({ consignment: c, signal: { kind: 'EXCURSION', direction: 'HEAT' }, readings: rising, product: PENTA, legs, now })
  assert.equal(near.atRisk, false, 'arrives in ~10 min, long before the budget runs out')
  const far = scenario.project({ consignment: c, signal: { kind: 'EXCURSION', direction: 'HEAT' }, readings: rising, product: PENTA, legs: [{ ...legs[0], plannedMins: 900 }], now })
  assert.equal(far.atRisk, true)
  assert.ok(far.probability > 0.6)
})

test('compliance: product disposition is never automated', () => {
  for (const kind of ['QUARANTINE', 'RELEASE', 'DESTROY']) assert.equal(compliance.gate({ kind, costInr: 0 }).verdict, 'REQUIRE_QA')
  assert.equal(compliance.gate({ kind: 'DIVERT', costInr: 12000 }).verdict, 'REQUIRE_MEERA')
  assert.equal(compliance.gate({ kind: 'TELEPORT', costInr: 0 }).verdict, 'ADVISORY_ONLY')
})

test('compliance: a frozen batch cannot be recommended for release', () => {
  const d = compliance.dispositions({ kind: 'FREEZE', alreadyBreached: true }, PENTA)
  assert.ok(!d.some(o => o.kind === 'RELEASE'))
  assert.ok(d.find(o => o.kind === 'QUARANTINE').recommended)
})
