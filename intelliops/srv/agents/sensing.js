// Sensing Agent — the functional core. Three detectors plus one business event.
// Pure: detect(context) -> signals[]. It never writes and never reads simulator state.

const { minutesBetween, round } = require('../lib/time')
const MIN_RUN = 3        // one bad reading is an artefact; three in a row is an event
const CADENCE = 5        // loggers report every 5 minutes
const STALL_GAP = CADENCE * 6

// Detector 1 — excursion onset, trend-confirmed. Scans every reading since the last tick,
// so a freeze that has already recovered is still caught.
function excursion ({ readings, product, since }) {
  let run = [], found = null
  for (const r of readings) {
    const dir = r.tempC > product.maxTempC ? 'HEAT' : (r.tempC < product.minTempC ? 'FREEZE' : null)
    if (dir && run.length && run[0].dir === dir) run.push({ ...r, dir })
    else run = dir ? [{ ...r, dir }] : []
    if (run.length >= MIN_RUN && Date.parse(r.at) > since) found = [...run]
  }
  if (!found) return null
  const dir = found[0].dir, last = found.at(-1)
  const extreme = dir === 'HEAT' ? Math.max(...found.map(r => r.tempC)) : Math.min(...found.map(r => r.tempC))
  return {
    kind: 'EXCURSION', direction: dir,
    detail: dir === 'HEAT'
      ? `${last.tempC}°C, ${found.length} consecutive readings above ${product.maxTempC}°C over ${round(minutesBetween(found[0].at, last.at) + CADENCE, 0)} min`
      : `${extreme}°C, ${found.length} consecutive readings below ${product.minTempC}°C${product.freezeSensitive ? ' — freeze-sensitive product' : ''}`,
    // freezing is effectively irreversible for adjuvanted vaccines — never a scaled excursion
    severity: dir === 'FREEZE' ? (product.freezeSensitive ? 1.0 : 0.3) : Math.min(1, (last.tempC - product.maxTempC) / 10),
    evidence: found.map(r => ({ at: r.at, tempC: r.tempC }))
  }
}

// Detector 2 — handover dwell, against the learned P95 for this route and leg
function dwell ({ consignment, leg, model, now }) {
  if (!leg || leg.exitedAt || !['DISPATCH', 'HANDOVER'].includes(leg.kind)) return null
  const elapsed = Math.round(minutesBetween(leg.enteredAt, now))
  if (elapsed <= model.p95Mins) return null
  return {
    kind: 'DWELL',
    detail: `${elapsed} min at ${leg.kind === 'DISPATCH' ? 'dispatch' : 'handover'} on ${consignment.route}, P95 is ${model.p95Mins} (${model.mode.toLowerCase()}, n=${model.samples})`,
    severity: Math.min(1, elapsed / (model.p95Mins * 2)),
    mode: model.mode, model
  }
}

// Detector 3 — silent stall. Fires on an absence, which no threshold tool can do:
// a logger that stops reporting is a problem, not an absence of problems.
function silentStall ({ consignment, lastReading, now }) {
  const gap = Math.round(minutesBetween(lastReading?.at ?? consignment.departedAt, now))
  if (gap < STALL_GAP) return null
  return {
    kind: 'SILENT_STALL',
    detail: `No reading or movement for ${gap} min on route ${consignment.route}${lastReading ? `, last seen at ${lastReading.tempC}°C, km ${lastReading.km}` : ''}`,
    severity: Math.min(1, gap / (CADENCE * 24)),
    gap
  }
}

// Business event — a batch placed on quality hold in the ERP (Event Mesh in production)
function qualityHold ({ consignment, holds }) {
  const h = holds.find(h => h.batch === consignment.batch)
  if (!h) return null
  return { kind: 'QUALITY_HOLD', detail: `Batch ${h.batch} on quality hold: ${h.reason}`, severity: 0.9, hold: h }
}

// Debounce: one excursion must not produce a signal every tick
const recent = new Map()
function shouldEmit (key, now, cooldownMins = 30) {
  const seen = recent.get(key)
  if (seen && minutesBetween(seen, now) < cooldownMins) return false
  recent.set(key, now); return true
}
function resetDebounce () { recent.clear() }

function detect (ctx) {
  const id = ctx.consignment.ID
  const out = []
  const ex = excursion(ctx)
  if (ex && shouldEmit(`${id}:EXCURSION:${ex.direction}`, ctx.now)) out.push(ex)
  const dw = dwell(ctx)
  if (dw && shouldEmit(`${id}:DWELL`, ctx.now, 60)) out.push(dw)
  const st = silentStall(ctx)
  if (st && shouldEmit(`${id}:SILENT_STALL`, ctx.now)) out.push(st)
  const qh = qualityHold(ctx)
  if (qh && shouldEmit(`${id}:QUALITY_HOLD`, ctx.now, 24 * 60)) out.push(qh)
  return out
}

module.exports = { detect, excursion, dwell, silentStall, qualityHold, resetDebounce, STALL_GAP }
