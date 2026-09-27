// Scenario Agent — time to breach. A product has an exposure budget that drains:
// every minute outside range consumes budget, weighted by how far outside it sits.

const { minutesBetween, addMinutes, clamp, round, fmtIST } = require('../lib/time')
const memory = require('./memory')

const HORIZON = 24 * 60
const FREEZE_WEIGHT = 5          // freezing costs far more
const BLIND_SLOPE = 0.06         // °C/min: worst case for a reefer that has gone dark (from route memory)
const REPLACEMENT_LEAD_H = 48    // sessions further out can be resupplied, so they are not at risk

const weight = excess => 1 + 0.22 * Math.max(0, excess - 1)   // 1.0 at +1°, ~3 at +10°
const ambientAt = t => { const h = new Date(t + 5.5 * 3600000).getUTCHours(); return h >= 9 && h <= 18 ? 33 : 27 }

function consumedBudget (readings, product) {
  let above = 0, below = 0
  for (let i = 1; i < readings.length; i++) {
    const mins = Math.min(10, minutesBetween(readings[i - 1].at, readings[i].at)) // a gap is not exposure evidence
    const t = readings[i].tempC
    if (t > product.maxTempC) above += mins * weight(t - product.maxTempC)
    else if (t < product.minTempC) below += mins * FREEZE_WEIGHT
  }
  return { above: round(above, 0), below: round(below, 0) }
}

// °C per minute, least squares over the last 20 minutes of readings
function recentSlope (readings) {
  const last = readings.at(-1); if (!last) return 0
  const xs = readings.filter(r => minutesBetween(r.at, last.at) <= 20)
  if (xs.length < 3) return 0
  const x = xs.map(r => minutesBetween(xs[0].at, r.at)), y = xs.map(r => r.tempC)
  const mx = x.reduce((a, b) => a + b) / x.length, my = y.reduce((a, b) => a + b) / y.length
  const num = x.reduce((a, xi, i) => a + (xi - mx) * (y[i] - my), 0), den = x.reduce((a, xi) => a + (xi - mx) ** 2, 0)
  return den ? num / den : 0
}

// Walk the trajectory forward minute by minute. `recoverAfter` models an option that gets the
// product back into a cold room: after that many minutes, the burn stops.
function burn ({ product, used, from, startTemp, slope, recoverAfter = Infinity, horizon = HORIZON }) {
  let above = used.above, below = used.below
  const series = []
  const cap = ambientAt(from)
  if (above >= product.budgetMinutesAbove || below >= product.budgetMinutesBelow) return { minsToBreach: 0, series, above, below }
  for (let t = 1; t <= horizon; t++) {
    if (t > recoverAfter) return { minsToBreach: Infinity, series, above, below, recovered: true }
    const T = clamp(startTemp + slope * t, -25, cap)
    if (t % 5 === 0 && series.length < 160) series.push({ at: new Date(addMinutes(from, t)).toISOString(), tempC: round(T) })
    if (T > product.maxTempC) above += weight(T - product.maxTempC)
    else if (T < product.minTempC) below += FREEZE_WEIGHT
    if (above >= product.budgetMinutesAbove || below >= product.budgetMinutesBelow) return { minsToBreach: t, series, above, below }
    if (slope <= 0 && T <= product.maxTempC && T >= product.minTempC) break // recovering and in range: nothing more burns
  }
  return { minsToBreach: Infinity, series, above, below }
}

// Remaining journey as the agent knows it: planned for travel still ahead, learned medians for docks
function remainingJourney (c, legs, now) {
  let mins = 0
  for (const l of legs) {
    if (l.exitedAt) continue
    const model = memory.dwellModel(c.route, l.kind)
    const travel = l.kind === 'LONGHAUL' || l.kind === 'LASTMILE'
    const expected = travel ? l.plannedMins : (model.mode === 'LEARNED' ? model.medianMins : l.plannedMins)
    if (l.enteredAt) mins += Math.max(10, expected - (travel ? (l.movedMins || 0) : minutesBetween(l.enteredAt, now)))
    else mins += expected
  }
  return Math.round(mins)
}

function project ({ consignment: c, signal, readings, product, legs, now }) {
  const used = consumedBudget(readings, product)
  const budget = { above: product.budgetMinutesAbove, below: product.budgetMinutesBelow }
  const remaining = remainingJourney(c, legs, now)
  const arrivalAt = addMinutes(now, remaining)
  const last = readings.at(-1)
  const base = { kind: signal.kind, used, budget, remainingJourneyMins: remaining, arrivalAt: new Date(arrivalAt).toISOString(), currentTempC: last?.tempC }

  if (signal.kind === 'QUALITY_HOLD') {
    return { ...base, kind: 'QUALITY_HOLD', atRisk: true, probability: 0.9, minsToBreach: 0, alreadyBreached: true, breachAt: null, series: [],
      basis: 'Batch is on quality hold — unusable until QA releases it, whatever the temperature.' }
  }

  if (signal.kind === 'SILENT_STALL') {
    // no data: project blind from the last known reading with the worst-case slope
    const from = last ? Date.parse(last.at) : Date.parse(c.departedAt)
    const b = burn({ product, used, from, startTemp: last?.tempC ?? 5, slope: BLIND_SLOPE })
    const breachAt = isFinite(b.minsToBreach) ? addMinutes(from, b.minsToBreach) : null
    const blindBreachIn = breachAt ? minutesBetween(now, breachAt) : Infinity
    const gap = signal.gap
    // arrival is unknowable while it is dark: the absence itself is the risk
    const atRisk = true
    return { ...base, kind: 'SILENT_STALL', blind: true, gapMins: gap, slopePerHr: round(BLIND_SLOPE * 60), series: b.series,
      minsToBreach: blindBreachIn, breachAt: breachAt && new Date(breachAt).toISOString(), atRisk,
      probability: round(clamp(0.5 + gap / 200 + (blindBreachIn <= remaining ? 0.1 : 0), 0.05, 0.95), 2),
      basis: `No data for ${gap} min. Worst case assumes the reefer went dark at the last reading and warms ${round(BLIND_SLOPE * 60)}°C/hr.` }
  }

  const slope = recentSlope(readings)
  const b = burn({ product, used, from: now, startTemp: last.tempC, slope })
  const alreadyBreached = b.minsToBreach === 0
  const minsToBreach = b.minsToBreach
  const breachAt = isFinite(minsToBreach) ? new Date(addMinutes(now, minsToBreach)).toISOString() : null
  const sigma = 20 + 0.25 * (isFinite(minsToBreach) ? minsToBreach : HORIZON)
  const z = (remaining - minsToBreach) / sigma
  const probability = alreadyBreached ? 0.98 : clamp(1 / (1 + Math.exp(-1.7 * z)), 0.05, 0.98)
  const kind = signal.kind === 'EXCURSION' ? signal.direction : signal.kind
  return {
    ...base, kind, slopePerHr: round(slope * 60, 1), series: b.series, minsToBreach, breachAt, alreadyBreached,
    probability: round(probability, 2),
    // the key line: in trouble only if it breaches before it arrives
    atRisk: alreadyBreached || minsToBreach < remaining,
    basis: alreadyBreached
      ? `Budget already exhausted: ${used.above} of ${budget.above} heat minutes, ${used.below} of ${budget.below} freeze minutes.`
      : `${used.above} of ${budget.above} exposure minutes used; at ${round(slope * 60, 1)}°C/hr the rest is gone in ${isFinite(minsToBreach) ? Math.round(minsToBreach) + ' min' : 'more than 24 h'}; arrival is ${remaining} min away.`
  }
}

module.exports = { project, consumedBudget, recentSlope, burn, remainingJourney, weight, REPLACEMENT_LEAD_H, fmtIST }
