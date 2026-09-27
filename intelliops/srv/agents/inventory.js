// Inventory Agent — blast radius. With the Serves link in place this is a query, not an algorithm.

const cds = require('@sap/cds')
const { sum, unique, round } = require('../lib/time')
const { REPLACEMENT_LEAD_H } = require('./scenario')

async function servesFor (db, consignmentIds) {
  const m = cds.entities('intelliops')
  return db.run(SELECT.from(m.Serves).where({ consignment_ID: { in: consignmentIds } })
    .columns(s => { s.consignment_ID, s.doses, s.session(x => { x.ID, x.sessionDate, x.antigen, x.expectedChildren,
      x.facility(f => { f.ID, f.name, f.code, f.district, f.bufferDoses, f.kind }) }) }))
}

// consignments: the one at risk, or every live consignment of a held batch
async function blastRadius (db, consignments, districtFacilities) {
  const serves = await servesFor(db, consignments.map(c => c.ID))
  const latestPromise = Math.max(...consignments.map(c => Date.parse(c.promisedAt)))
  const horizon = latestPromise + REPLACEMENT_LEAD_H * 3600000
  const covered = s => s.session.facility.bufferDoses >= s.doses
  const soon = s => Date.parse(s.session.sessionDate) <= horizon
  const atRisk = serves.filter(s => soon(s) && !covered(s))

  // buffer that could be moved: facilities in the same district not themselves at risk
  const atRiskFacs = new Set(atRisk.map(s => s.session.facility.ID))
  const needDoses = sum(atRisk, s => s.doses)
  const donors = (districtFacilities || []).filter(f => !atRiskFacs.has(f.ID) && f.kind !== 'DISTRICT_STORE' && f.bufferDoses > 0)
    .sort((a, b) => b.bufferDoses - a.bufferDoses)
  let acc = 0; const picked = []
  for (const f of donors) { if (acc >= needDoses) break; picked.push(f); acc += Math.floor(f.bufferDoses * 0.5) } // keep half for their own sessions

  const byFacility = {}
  for (const s of serves) {
    const f = s.session.facility
    const e = byFacility[f.ID] ??= { name: f.name, code: f.code, bufferDoses: f.bufferDoses, sessions: [] }
    e.sessions.push({ date: s.session.sessionDate, antigen: s.session.antigen, doses: s.doses, children: s.session.expectedChildren,
      covered: covered(s), atRisk: soon(s) && !covered(s) })
  }
  const facilities = Object.values(byFacility).sort((a, b) => Number(b.sessions.some(x => x.atRisk)) - Number(a.sessions.some(x => x.atRisk)) || a.name.localeCompare(b.name))
  for (const f of facilities) f.sessions.sort((a, b) => Date.parse(a.date) - Date.parse(b.date))

  return {
    facilities,
    facilitiesCount: unique(serves.map(s => s.session.facility.ID)).length,
    sessions: serves.length,
    dosesAtRisk: sum(consignments, c => c.doses),
    dosesCommitted: sum(serves, s => s.doses),
    // excludes facilities holding buffer: stops the number being theatrical
    childrenAtRisk: sum(atRisk, s => s.session.expectedChildren),
    atRiskSessions: atRisk.map(s => ({ facility: s.session.facility.name, date: s.session.sessionDate, doses: s.doses, children: s.session.expectedChildren })),
    earliestAtRisk: atRisk.length ? atRisk.map(s => s.session.sessionDate).sort()[0] : null,
    replacementHorizon: new Date(horizon).toISOString(),
    reallocatable: acc >= needDoses && needDoses > 0 ? { donors: picked.map(f => ({ name: f.name, doses: Math.floor(f.bufferDoses * 0.5) })), doses: acc, need: needDoses } : null,
    consignmentRefs: consignments.map(c => c.ref),
    coverageNote: `${round(100 * sum(serves.filter(covered), s => s.doses) / (sum(serves, s => s.doses) || 1), 0)}% of committed doses are covered by on-site buffer`
  }
}

function shouldEscalate (forecast, impact, openCount) {
  return forecast.probability > 0.6
    && impact.childrenAtRisk > 0
    && openCount < 8
}

module.exports = { blastRadius, shouldEscalate }
