// Compliance Agent — the gate. A veto, not a comment.
// Product disposition (release, quarantine, destroy) is never automated, at any autonomy level.

const DISPOSITION = ['QUARANTINE', 'RELEASE', 'DESTROY']
const POLICY = {
  autonomyLevel: 1,                // level 1: agents propose, humans execute everything
  maxAutoCostInr: 25000,
  allowedActions: ['DIVERT', 'REICE', 'EXPEDITE', 'REALLOCATE', 'REPLACE', 'REPROMISE']
}

function gate (option) {
  if (DISPOSITION.includes(option.kind)) return { verdict: 'REQUIRE_QA', reason: 'Product disposition is never automated' }
  if (option.costInr > POLICY.maxAutoCostInr) return { verdict: 'REQUIRE_MEERA', reason: `Above the ₹${POLICY.maxAutoCostInr.toLocaleString('en-IN')} auto-approval ceiling` }
  if (!POLICY.allowedActions.includes(option.kind)) return { verdict: 'ADVISORY_ONLY', reason: 'Outside the configured policy envelope' }
  return { verdict: 'REQUIRE_MEERA', reason: 'Level 1 autonomy — human executes' }
}

// What QA can decide about the product itself, with the agent's recommendation
function dispositions (forecast, product) {
  const freeze = forecast.kind === 'FREEZE'
  const unknown = forecast.kind === 'SILENT_STALL'
  const hold = forecast.kind === 'QUALITY_HOLD'
  const exhausted = forecast.alreadyBreached && !hold
  const unsaveable = forecast.noRecovery && !hold // will breach and nothing gets it cold in time
  const out = [{
    kind: 'QUARANTINE',
    label: freeze ? 'Quarantine on arrival — shake test before any use' : unknown ? 'Quarantine on arrival — exposure unknown while dark' : hold ? 'Keep batch quarantined pending investigation' : 'Quarantine on arrival for QA review',
    detail: 'Stock held apart, labelled, not issued',
    recommended: freeze || unknown || hold || exhausted || unsaveable
  }]
  if (!exhausted && !freeze) out.push({ kind: 'RELEASE', label: hold ? 'Release the batch — hold was precautionary' : 'Release after VVM check on arrival', detail: hold ? 'Only if the investigation clears the batch' : 'Budget not exhausted — product still within stability data', recommended: !(unknown || hold || unsaveable) })
  if (exhausted || freeze) out.push({ kind: 'DESTROY', label: 'Destroy — potency cannot be assured', detail: freeze ? 'Freezing of an adjuvanted vaccine is irreversible' : 'Exposure budget exhausted', recommended: false })
  return out.map(o => ({ ...o, needsQA: true, costInr: 0, confidence: null, ...gateFields(o) }))
}
const gateFields = o => { const g = gate(o); return { verdict: g.verdict, gateReason: g.reason } }

function evidencePack ({ escalation, consignment, product, readings, signal, forecast, impact, options, rejected, decision }) {
  return {
    generatedAt: decision?.at,
    consignment: consignment.ref, batch: consignment.batch, product: product.name, doses: consignment.doses,
    route: consignment.route, vehicle: consignment.vehicle, carrier: consignment.carrier,
    readings: readings.map(r => [r.at, r.tempC]),
    detection: { kind: signal.kind, detectedAt: escalation.raisedAt, detail: signal.detail, model: signal.model ? { p95Mins: signal.model.p95Mins, mode: signal.model.mode, samples: signal.model.samples } : null },
    projection: { breachAt: forecast.breachAt, pointOfNoReturn: forecast.pointOfNoReturn, probability: forecast.probability, used: forecast.used, budget: forecast.budget },
    impact: { facilities: impact.facilitiesCount, sessions: impact.sessions, dosesAtRisk: impact.dosesAtRisk, childrenAtRisk: impact.childrenAtRisk },
    optionsConsidered: options.map(o => ({ kind: o.kind, label: o.label, confidence: o.confidence, verdict: o.verdict, chosen: !!o.chosen })),
    optionsRejected: rejected,
    decisions: decision ? [decision] : [],
    policy: { autonomyLevel: POLICY.autonomyLevel, maxAutoCostInr: POLICY.maxAutoCostInr },
    modelVersions: { sensing: 'v1', scenario: 'v1', inventory: 'v1', logistics: 'v1', compliance: 'v1' }
  }
}

module.exports = { gate, dispositions, evidencePack, POLICY, DISPOSITION }
