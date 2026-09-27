const cds = require('@sap/cds')
// Route memory: learned dwell models, and fingerprints of past disruptions.
// Production: HANA Cloud vector engine. Here: cosine similarity over five numbers.

let models = [], cases = []

async function load (db) {
  const m = cds.entities('intelliops')
  models = await db.run(SELECT.from(m.DwellModels))
  cases = await db.run(SELECT.from(m.RouteMemory))
}

function dwellModel (route, legKind) {
  return models.find(x => x.route === route && x.legKind === legKind)
    || { route, legKind, medianMins: 60, p95Mins: 90, sigmaMins: 15, samples: 0, mode: 'PLANNED' }
}

const LEG = { DISPATCH: 0, LONGHAUL: 1, LASTMILE: 2, HANDOVER: 3 }
function vector (x) {
  const h = (x.hourOfDay ?? 12) / 24 * 2 * Math.PI
  return [Math.cos(h), Math.sin(h), (LEG[x.legKind] ?? 1) / 3, (x.peakTempC ?? 8) / 12, (x.minutesOut ?? 60) / 160]
}
function cosine (a, b) {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2 }
  return d / Math.sqrt(na * nb || 1)
}

// query: { route, legKind, kind, hourOfDay, peakTempC, minutesOut }
function similar (query, k = 3) {
  const q = vector(query)
  return cases
    .filter(c => c.kind === query.kind)
    .map(c => ({ ...c, similarity: cosine(q, vector(c)) * (c.route === query.route ? 1 : 0.85) * (c.legKind === query.legKind ? 1 : 0.8) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k)
    .map(c => ({ summary: c.summary, action: c.action, outcome: c.outcome, route: c.route, similarity: Math.round(c.similarity * 100) / 100 }))
}

function actionRecord (kind, action) {
  const xs = cases.filter(c => c.kind === kind && c.action === action)
  return { n: xs.length, saved: xs.filter(c => c.outcome === 'SAVED').length }
}

module.exports = { load, dwellModel, similar, actionRecord }
