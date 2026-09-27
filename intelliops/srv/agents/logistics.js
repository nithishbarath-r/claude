// Logistics Agent — recovery options. Generated from data, then simulated on a copy.
// Each generator returns null when the option is not feasible; the reason is kept for the evidence pack.

const { ROUTES, facilities: masterFacilities, LONGHAUL_SPEED, LASTMILE_SPEED } = require('../../sim/master')
const { addMinutes, minutesBetween, round, fmtIST, fmtDur } = require('../lib/time')
const { burn, recentSlope, consumedBudget } = require('./scenario')
const memory = require('./memory')

const MASTER = Object.fromEntries(masterFacilities().map(f => [f.code, f]))
const BASE_CONFIDENCE = { DIVERT: 0.8, REICE: 0.72, EXPEDITE: 0.66, REALLOCATE: 0.75, REPLACE: 0.7, REPROMISE: 0.95 }
const iso = t => new Date(t).toISOString()

// Simulate on a copy — the live consignment is untouched until a human approves.
function simulate (ctx, durationMins) {
  const { forecast, product, readings, now } = ctx
  const last = readings.at(-1)
  const used = consumedBudget(readings, product)
  const blind = forecast.kind === 'SILENT_STALL'
  const from = blind && last ? Date.parse(last.at) : now
  const lag = blind ? minutesBetween(from, now) : 0
  const r = burn({ product, used, from, startTemp: last?.tempC ?? 5, slope: blind ? 0.06 : recentSlope(readings), recoverAfter: durationMins + lag })
  const remainingBudget = Math.max(0, product.budgetMinutesAbove - r.above)
  return { saves: !isFinite(r.minsToBreach), marginMins: round(remainingBudget, 0), breachBeforeArrivalMins: isFinite(r.minsToBreach) ? Math.round(r.minsToBreach - lag) : null }
}

function position (leg) {
  if (!leg || !(leg.kind === 'LONGHAUL' || leg.kind === 'LASTMILE')) return 0
  return Math.min(leg.km, (leg.movedMins || 0) * (leg.kind === 'LONGHAUL' ? LONGHAUL_SPEED : LASTMILE_SPEED) / 60)
}

function saveOption (ctx, kind, label, detail, durationMins, costInr, extra = {}) {
  const sim = simulate(ctx, durationMins)
  if (!sim.saves) {
    ctx.rejected.push({ kind, label, reason: `takes ${fmtDur(durationMins)}; the budget runs out ${fmtDur(sim.breachBeforeArrivalMins)} in — before it gets there` })
    return null
  }
  const breach = ctx.forecast.breachAt ? Date.parse(ctx.forecast.breachAt) : null
  return { kind, label, detail, durationMins, costInr, projectedAt: iso(addMinutes(ctx.now, durationMins)),
    actBy: breach ? iso(addMinutes(breach, -durationMins)) : null, saves: true, sim, ...extra }
}

// --- the five kinds ----------------------------------------------------------

function divertToColdStore (ctx) {
  const { leg, route, facilities, now } = ctx
  if (!leg || !(leg.kind === 'LONGHAUL' || leg.kind === 'LASTMILE')) return null
  const pos = position(leg)
  let target, km
  if (leg.kind === 'LONGHAUL') {
    const ahead = (route.stops || []).filter(([code, at]) => at > pos && facilities[code]?.coldRoom).sort((a, b) => a[1] - b[1])[0]
    if (!ahead || ahead[1] >= leg.km - 1) { ctx.rejected.push({ kind: 'DIVERT', label: 'Divert to a cold store', reason: 'no cold store on the corridor ahead before the destination' }); return null }
    target = facilities[ahead[0]]; km = ahead[1] - pos
  } else {
    // a vaccine carrier's nearest cold room is the district store it left
    target = facilities[`DS-${route.district}`]; km = pos
    if (!target?.coldRoom || target.bufferDoses === 0 && km > 30) { /* still feasible to return; stock level matters only for replacement */ }
  }
  const mins = Math.round(km / (leg.kind === 'LONGHAUL' ? LONGHAUL_SPEED : LASTMILE_SPEED) * 60) + 10
  return saveOption(ctx, 'DIVERT', `Divert to ${target.name} cold room, re-ice`,
    `${Math.round(km)} km ${leg.kind === 'LONGHAUL' ? 'ahead' : 'back'} · arrives ${fmtIST(addMinutes(now, mins))} · transfer to backup reefer, continue after QA check`,
    mins, 12000 + Math.round(km * 45), { target: target.code, km: Math.round(km) })
}

function reIceAtTransfer (ctx) {
  const { leg, route, now } = ctx
  if (!leg) return null
  if (leg.kind === 'DISPATCH') {
    return saveOption(ctx, 'REICE', 'Hold at dispatch, re-pack in the cold room', 'Still at the origin dock — back into the walk-in, re-pack with conditioned ice packs', 20, 1500)
  }
  if (leg.kind !== 'LASTMILE') { ctx.rejected.push({ kind: 'REICE', label: 'Re-ice at a transfer point', reason: 'a reefer has no ice packs to swap; no transfer point before the next store' }); return null }
  // nearest other facility with an ice-lined refrigerator on the same run
  const pos = position(leg)
  const peers = Object.values(MASTER).filter(f => f.district === ctx.destination.district && f.kind === 'PHC' && f.code !== ctx.destination.code && f.kmFromDS)
    .map(f => ({ f, km: Math.abs(f.kmFromDS - pos) + 12 })) // PHCs sit on different roads: +12 km cross-country
    .sort((a, b) => a.km - b.km)[0]
  if (!peers) return null
  const mins = Math.round(peers.km / LASTMILE_SPEED * 60) + 10
  return saveOption(ctx, 'REICE', `Re-ice at ${peers.f.name}`, `${Math.round(peers.km)} km · swap for conditioned packs from their ILR · arrives ${fmtIST(addMinutes(now, mins))}`,
    mins, 800 + Math.round(peers.km * 30), { target: peers.f.code })
}

function expedite (ctx) {
  const { leg, legs, destination, now } = ctx
  if (!leg) return null
  if (leg.kind === 'HANDOVER') {
    return saveOption(ctx, 'EXPEDITE', `Priority goods receipt at ${destination.name}`, 'Jump the receiving queue — into the walk-in cold room within 15 minutes', 15, 0)
  }
  if (!(leg.kind === 'LONGHAUL' || leg.kind === 'LASTMILE')) return null
  const next = legs.find(l => l.seq === leg.seq + 1)
  if (!next || next.kind !== 'HANDOVER') return null
  const left = leg.km - position(leg)
  const mins = Math.round(left / (leg.kind === 'LONGHAUL' ? LONGHAUL_SPEED : LASTMILE_SPEED) * 60) + 10
  return saveOption(ctx, 'EXPEDITE', `Expedite to ${destination.name}, priority receipt`, `${Math.round(left)} km to go · no stops · arrives ${fmtIST(addMinutes(now, mins))}`,
    mins, 4000 + Math.round(left * 20), { km: Math.round(left) })
}

function reallocateBuffer (ctx) {
  const { impact, now } = ctx
  if (!impact.childrenAtRisk) return null
  if (!impact.reallocatable) { ctx.rejected.push({ kind: 'REALLOCATE', label: 'Reallocate buffer', reason: `no facility in the district holds spare buffer for ${impact.atRiskSessions.reduce((a, s) => a + s.doses, 0)} doses` }); return null }
  const names = impact.reallocatable.donors.map(d => d.name.replace('PHC ', '').replace('Govt Hospital, ', 'GH '))
  const first = Date.parse(impact.earliestAtRisk)
  return { kind: 'REALLOCATE', label: `Reallocate buffer from ${names.slice(0, 2).join(' and ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`,
    detail: `${impact.reallocatable.need} doses to ${impact.atRiskSessions.length} session${impact.atRiskSessions.length > 1 ? 's' : ''} · the batch itself is not saved, the sessions are`,
    durationMins: 150, costInr: 3000 * impact.reallocatable.donors.length, projectedAt: iso(addMinutes(now, 150)),
    actBy: iso(addMinutes(first, -180)), saves: false, protectsSessions: true }
}

function replacement (ctx) {
  const { route, facilities, impact, consignment: c, now } = ctx
  if (!impact.childrenAtRisk) return null
  const source = route.kind === 'LONGHAUL' ? facilities['SS-CHN'] : facilities[`DS-${route.district}`]
  if (!source || source.bufferDoses < c.doses) {
    ctx.rejected.push({ kind: 'REPLACE', label: 'Emergency replacement', reason: `${source?.name ?? 'source store'} holds no spare stock of this antigen — this consignment is single-source` })
    return null
  }
  const lead = route.kind === 'LONGHAUL' ? Math.round(route.km / LONGHAUL_SPEED * 60) + 150 : 40 + 90
  const arrive = addMinutes(now, lead)
  if (arrive > Date.parse(impact.earliestAtRisk) - 60 * 60000) {
    ctx.rejected.push({ kind: 'REPLACE', label: 'Emergency replacement', reason: `would arrive ${fmtIST(arrive)}, after the first session` })
    return null
  }
  return { kind: 'REPLACE', label: `Emergency replacement from ${source.name}`, detail: `${c.doses.toLocaleString('en-IN')} doses · arrives ${fmtIST(arrive, { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`,
    durationMins: lead, costInr: 25000 + (route.km || 60) * 60, projectedAt: iso(arrive), actBy: iso(addMinutes(Date.parse(impact.earliestAtRisk), -lead - 60)), saves: false, protectsSessions: true }
}

function repromise (ctx) {
  const { impact, now } = ctx
  const n = impact.atRiskSessions.length
  const first = impact.earliestAtRisk ? Date.parse(impact.earliestAtRisk) : addMinutes(now, 24 * 60)
  return { kind: 'REPROMISE', label: n ? `Re-promise ${n} session${n > 1 ? 's' : ''}, notify facilities now` : 'Re-promise delivery date to the destination',
    detail: n ? `${impact.childrenAtRisk} children rescheduled · ASHA workers told before they mobilise families` : 'Honest new ETA to the receiving store',
    durationMins: 30, costInr: 0, projectedAt: iso(addMinutes(now, 30)), actBy: iso(addMinutes(first, -16 * 60)), saves: false, fallback: true }
}

// --- the agent ---------------------------------------------------------------

function confidenceFor (o, signalKind, similar) {
  let conf = BASE_CONFIDENCE[o.kind] ?? 0.6
  const rec = memory.actionRecord(signalKind, o.kind)
  if (rec.n >= 2) conf = 0.6 * conf + 0.4 * (rec.saved / rec.n)
  if (o.sim) conf *= 0.75 + 0.25 * Math.min(1, o.sim.marginMins / 120)
  return { confidence: Math.round(conf * 100) / 100, record: rec, similar: similar.filter(s => s.action === o.kind) }
}

function options (ctx) {
  ctx.rejected = []
  ctx.route = ROUTES.find(r => r.code === ctx.consignment.route)
  const protectOnly = ctx.forecast.alreadyBreached || ctx.forecast.kind === 'QUALITY_HOLD'
  if (protectOnly) ctx.rejected.push({ kind: 'DIVERT', label: 'Save the batch', reason: ctx.forecast.kind === 'QUALITY_HOLD' ? 'batch is on quality hold — moving it changes nothing' : 'exposure budget already exhausted — protect the sessions instead' })

  const savers = protectOnly ? [] : [divertToColdStore(ctx), reIceAtTransfer(ctx), expedite(ctx)].filter(Boolean)
  const protectors = [reallocateBuffer(ctx), savers.length ? null : replacement(ctx)].filter(Boolean)
  const candidates = [...savers, ...protectors, repromise(ctx)]

  const similar = memory.similar(ctx.memoryQuery, 5)
  for (const o of candidates) {
    const c = confidenceFor(o, ctx.forecast.kind === 'SILENT_STALL' ? 'SILENT_STALL' : (ctx.forecast.kind === 'FREEZE' ? 'FREEZE' : 'HEAT'), similar)
    o.confidence = c.confidence
    o.provenance = { simulation: o.sim ?? null, durationMins: o.durationMins, record: c.record, similar: c.similar, costBasis: 'illustrative constants' }
  }
  // saving the product beats protecting the sessions; re-promise is always last
  if (ctx.forecast.kind === 'SILENT_STALL') for (const o of savers) o.detail = `Once the driver is reached · ${o.detail}`
  const ranked = [...savers.sort((a, b) => b.confidence - a.confidence || a.costInr - b.costInr), ...protectors.sort((a, b) => b.confidence - a.confidence), candidates.at(-1)]
  ranked.forEach((o, i) => { o.rank = i + 1; o.recommended = i === 0 })
  const longest = Math.max(0, ...savers.map(o => o.durationMins))
  return { options: ranked, rejected: ctx.rejected, recoveryWindowMins: savers.length ? longest : null }
}

module.exports = { options, position }
