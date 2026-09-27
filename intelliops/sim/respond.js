// How the simulated world responds once a human-approved instruction reaches the transporter.
// In production this is the transporter acting on the instruction; here the simulator plays them.

const { STEP } = require('./physics')
const iso = t => new Date(t).toISOString()

async function respond (feed, consignmentId, option, now) {
  const c = feed.live.find(x => x.ID === consignmentId)
  if (!c) return
  const faults = feed.faultsFor(c.ID).filter(f => !f.endAt || Date.parse(f.endAt) > now)
  const leg = c.legs.find(l => !l.exitedAt)
  switch (option.kind) {
    case 'DIVERT':
    case 'REICE':
      for (const f of faults) {
        if (f.kind === 'HEAT') { f.params.stationary = false; f.endAt = iso(now + option.durationMins * 60000); f.params.recoverTau = 20 }
        if (f.kind === 'STALL') f.endAt = iso(now + STEP) // driver reached, logger power-cycled
        await feed.updateFault(f)
      }
      break
    case 'EXPEDITE':
      for (const f of faults) {
        if (f.kind === 'HEAT') { f.params.stationary = false; f.params.endOnArrival = true; if (leg?.kind === 'HANDOVER') f.endAt = iso(now + 15 * 60000) }
        if (f.kind === 'STALL') f.endAt = iso(now + STEP)
        await feed.updateFault(f)
      }
      if (leg?.kind === 'HANDOVER') { leg.simActualMins = Math.round((now - Date.parse(leg.enteredAt)) / 60000) + 15; await feed.updateLeg(leg) }
      break
    default: // reallocate, replace, re-promise and dispositions change plans and records, not the physics
  }
}

module.exports = { respond }
