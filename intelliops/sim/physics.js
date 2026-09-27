// Temperature and movement model for the simulator. Deterministic: the same consignment
// at the same simulated minute always reads the same temperature.

const { LONGHAUL_SPEED, LASTMILE_SPEED } = require('./master')

const CADENCE_MINS = 5
const STEP = CADENCE_MINS * 60000

function hash (str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
const noise = (seed, i) => ((hash(seed + ':' + i) % 2001) / 1000) - 1 // [-1, 1]

// What the reefer holds when nothing is wrong
function normalTemp (c, leg, t) {
  const base = 4.3 + (hash(c.ID) % 140) / 100 // 4.3–5.7 °C, per consignment
  let adj = 0
  if (leg.kind === 'DISPATCH' || leg.kind === 'HANDOVER') adj = 0.9 // doors opening
  if (leg.kind === 'LASTMILE') adj = Math.min(1.4, 0.3 * (t - Date.parse(leg.enteredAt)) / 3600000) // ice packs warming
  return base + adj + 0.25 * noise(c.ID, Math.floor(t / STEP))
}

function heatAt (f, base, t) {
  const p = f.params, s = Date.parse(f.startAt)
  const curve = x => p.Ta - (p.Ta - base) * Math.exp(-(x - s) / 60000 / p.tau)
  const end = f.endAt ? Date.parse(f.endAt) : null
  if (end && t > end) return base + (curve(end) - base) * Math.exp(-(t - end) / 60000 / (p.recoverTau || 25))
  return curve(t)
}

function freezeAt (f, base, t) {
  const p = f.params, s = Date.parse(f.startAt), dur = p.durMins * 60000
  if (t > s + dur) return base
  return base + (p.dipTo - base) * Math.sin(Math.PI * (t - s) / dur)
}

const active = (f, t) => t >= Date.parse(f.startAt) && (!f.endAt || t <= Date.parse(f.endAt))

// Advance one consignment from its last reading up to `now`.
// Mutates c.legs (movedMins, exitedAt, enteredAt) and c.status; returns new readings.
function advance (c, faults, now) {
  const readings = []
  let t = c.lastAt + STEP
  for (; t <= now; t += STEP) {
    const leg = c.legs.find(l => !l.exitedAt)
    if (!leg) break
    if (!leg.enteredAt) leg.enteredAt = new Date(t - STEP).toISOString()
    const live = faults.filter(f => Date.parse(f.startAt) <= t)
    const stalled = live.some(f => f.kind === 'STALL' && active(f, t))
    const stationary = stalled || live.some(f => f.kind === 'HEAT' && f.params.stationary && active(f, t))
    const travel = leg.kind === 'LONGHAUL' || leg.kind === 'LASTMILE'

    let moving = false
    if (travel && !stationary) { moving = true; leg.movedMins = (leg.movedMins || 0) + CADENCE_MINS }

    const base = normalTemp(c, leg, t)
    let temp = base
    for (const f of live) {
      if (f.kind === 'HEAT') temp = Math.max(temp, heatAt(f, base, t))
      if (f.kind === 'FREEZE') temp = Math.min(temp, freezeAt(f, base, t))
    }

    if (!stalled) {
      const speed = leg.kind === 'LONGHAUL' ? LONGHAUL_SPEED : LASTMILE_SPEED
      readings.push({
        consignment_ID: c.ID, at: new Date(t).toISOString(),
        tempC: Math.round(temp * 10) / 10, moving,
        km: travel ? Math.min(leg.km, Math.round((leg.movedMins || 0) * speed / 60)) : 0,
        legSeq: leg.seq
      })
    }

    // leg progression
    const elapsed = (t - Date.parse(leg.enteredAt)) / 60000
    const done = travel ? (leg.movedMins || 0) >= leg.simActualMins : (!stationary && elapsed >= leg.simActualMins)
    if (done) {
      leg.exitedAt = new Date(t).toISOString()
      const next = c.legs.find(l => l.seq === leg.seq + 1)
      if (next) {
        next.enteredAt = leg.exitedAt
        // arriving at a store ends a reefer problem: product goes into the cold room
        if (next.kind === 'HANDOVER') for (const f of faults) if (f.params.endOnArrival && !f.endAt) f.endAt = leg.exitedAt
      } else c.status = 'DELIVERED'
    }
  }
  c.lastAt = Math.min(t - STEP, now)
  return readings
}

module.exports = { advance, hash, noise, CADENCE_MINS, STEP }
