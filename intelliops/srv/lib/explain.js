// Turns a forecast into two sentences Meera can read. Language, not arithmetic:
// every number is computed deterministically before it gets here.
//
// Production path: SAP Generative AI Hub (orchestration service) behind this same signature.
// This prototype ships the deterministic template below; it does not call an LLM.

const { fmtIST, fmtDur, minutesBetween } = require('./time')

const day = t => fmtIST(t, { weekday: 'long' })

function narrate ({ consignment: c, product, destination, forecast: f, impact, now, similar = [] }) {
  const who = impact.childrenAtRisk
    ? `${impact.childrenAtRisk} children at ${impact.atRiskSessions.length} session${impact.atRiskSessions.length > 1 ? 's' : ''} on ${day(impact.earliestAtRisk)} depend on it`
    : `${impact.facilitiesCount} facilities downstream hold enough buffer to cover it`
  const act = f.noRecovery ? '. No recovery option gets it cold in time — the honest move is to re-promise now' : f.pointOfNoReturn ? `, so the decision is needed before ${fmtIST(f.pointOfNoReturn)}` : ''
  const past = similar[0] ? ` Closest past case: ${similar[0].summary}.` : ''
  switch (f.kind) {
    case 'HEAT':
      return `${c.ref} is at ${f.currentTempC}°C and rising ${f.slopePerHr}°C/hr; it has used ${f.used.above} of ${f.budget.above} exposure minutes and will cross the batch limit at ${fmtIST(f.breachAt)} — ${fmtDur(minutesBetween(f.breachAt, f.arrivalAt))} before it reaches ${destination.name}. ${who}${act}.${past}`
    case 'FREEZE':
      return `${c.ref} dropped below ${product.minTempC}°C and ${product.name} is freeze-sensitive: it reads normal now, but the potency loss is permanent and invisible. ${who}, so treat this batch as lost and protect the sessions.`
    case 'SILENT_STALL':
      return `${c.ref} has sent nothing for ${f.gapMins} minutes — no temperature, no movement — and the last reading was ${f.currentTempC}°C. If the reefer went dark with it, the batch limit goes at ${f.breachAt ? fmtIST(f.breachAt) : 'an unknown time'}; ${who}.`
    case 'QUALITY_HOLD':
      return `Batch ${c.batch} is on quality hold across ${impact.consignmentRefs.length} consignment${impact.consignmentRefs.length > 1 ? 's' : ''} in transit. ${who}, and the stock cannot be issued until QA decides.`
    default:
      return `${c.ref}: ${f.basis} ${who}.`
  }
}

module.exports = { narrate }
