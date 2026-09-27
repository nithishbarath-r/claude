const cds = require('@sap/cds')
const clock = require('./lib/clock')
const { iso, ms, minutesBetween, addMinutes, round, fmtIST, fmtDur } = require('./lib/time')
const { narrate } = require('./lib/explain')
const sensing = require('./agents/sensing')
const scenario = require('./agents/scenario')
const inventory = require('./agents/inventory')
const logistics = require('./agents/logistics')
const compliance = require('./agents/compliance')
const memory = require('./agents/memory')
const { Feed } = require('../sim/feed')
const { inject, candidates, KINDS } = require('../sim/inject')
const { respond } = require('../sim/respond')
const { generate } = require('../sim/generate')

const TICK_MS = 2000
const LOG = cds.log('guardian')
const ACTIVE = ['OPEN', 'ACTIONED']

module.exports = class CockpitService extends cds.ApplicationService {
  async init () {
    this.db = await cds.connect.to('db')
    this.m = cds.entities('intelliops')
    this.gateOn = true
    await this.boot()
    this.timer = setInterval(() => this.tick().catch(e => LOG.error('tick failed', e)), TICK_MS)
    cds.on('shutdown', () => clearInterval(this.timer))

    this.on('overview', () => this._overview())
    this.on('detail', req => this._detail(req.data.escalation))
    this.on('injectTargets', async req => JSON.stringify({ kinds: KINDS, candidates: await candidates(this.feed, this.db, req.data.kind) }))
    this.on('approve', req => this._approve(req))
    this.on('dismiss', req => this._dismiss(req))
    this.on('inject', async req => {
      const msg = await inject(this.feed, this.db, req.data.kind, req.data.ref, clock.now())
      await this.ledger({ agent: 'simulator', stage: 'INJECT', payload: { kind: req.data.kind, msg }, actor: 'demo' })
      return JSON.stringify({ ok: true, msg })
    })
    this.on('clock', req => {
      const { op, value } = req.data
      if (op === 'advance') clock.advance(Number(value))
      if (op === 'speed') clock.setSpeed(Number(value))
      if (op === 'pause') clock.pause(true)
      if (op === 'resume') clock.pause(false)
      return JSON.stringify(clock.status())
    })
    this.on('setGate', req => { this.gateOn = !!req.data.on; return JSON.stringify({ gateOn: this.gateOn }) })
    this.on('reset', () => this._reset())
    return super.init()
  }

  async boot () {
    const m = this.m
    await memory.load(this.db)
    this.feed = await new Feed().load(this.db)
    this.products = Object.fromEntries((await this.db.run(SELECT.from(m.Products))).map(p => [p.ID, num(p)]))
    this.facilities = await this.db.run(SELECT.from(m.Facilities))
    this.facById = Object.fromEntries(this.facilities.map(f => [f.ID, f]))
    this.facByCode = Object.fromEntries(this.facilities.map(f => [f.code, f]))
    this.lastTick = clock.now() - 3 * 3600000 // first pass looks back, so a world generated mid-problem is seen
  }

  async _reset () {
    clearInterval(this.timer)
    while (this.busy) await new Promise(r => setTimeout(r, 50))
    clock.reset()
    const stats = await generate(this.db)
    sensing.resetDebounce()
    await this.boot()
    this.gateOn = true
    await this.tick()
    this.timer = setInterval(() => this.tick().catch(e => LOG.error('tick failed', e)), TICK_MS)
    return JSON.stringify({ ok: true, stats })
  }

  // ---------------------------------------------------------------------------
  // The tick. One loop drives everything.
  // ---------------------------------------------------------------------------
  async tick () {
    if (this.busy) return
    this.busy = true
    try {
      const now = clock.now()
      await this.feed.step(now)
      const m = this.m
      const since = this.lastTick
      const recent = await this.db.run(SELECT.from(m.Readings).columns('consignment_ID', 'at', 'tempC', 'moving', 'km', 'legSeq')
        .where({ at: { '>': iso(since - 30 * 60000) } }).orderBy('at'))
      const byC = new Map()
      for (const r of recent) { const a = byC.get(r.consignment_ID) || []; a.push(numR(r)); byC.set(r.consignment_ID, a) }
      const holds = await this.db.run(SELECT.from(m.BatchHolds))

      for (const c of this.feed.live) {
        const leg = c.legs.find(l => !l.exitedAt)
        const signals = sensing.detect({
          consignment: c, readings: byC.get(c.ID) || [], product: this.products[c.product_ID], since, now, leg,
          model: leg ? memory.dwellModel(c.route, leg.kind) : null, lastReading: this.feed.lastReading.get(c.ID), holds
        })
        for (const s of signals) await this.handleSignal(c, s, now)
      }
      await this.refreshActive(now)
      this.lastTick = now
    } finally { this.busy = false }
  }

  async handleSignal (c, s, now) {
    const m = this.m, db = this.db
    const product = this.products[c.product_ID]
    const signal = { ID: cds.utils.uuid(), consignment_ID: c.ID, at: iso(now), kind: s.kind, detail: s.detail, severity: round(s.severity, 2), mode: s.mode || null }
    const log = async (outcome, reason, extra = {}) => {
      await db.run(INSERT.into(m.Signals).entries({ ...signal, outcome, reason }))
      await this.ledger({ agent: 'sensing', stage: 'SIGNAL', consignment_ID: c.ID, payload: { signal: s.kind, detail: s.detail, outcome, reason, ...extra } })
    }

    const active = await db.run(SELECT.one.from(m.Escalations).where({ consignment_ID: c.ID, state: { in: ACTIVE } }))
    if (active) return log('ATTACHED', `attached to open escalation (${active.kind})`)
    if (s.kind === 'QUALITY_HOLD') { // one escalation per held batch, not one per truck
      const sameBatch = this.feed.live.filter(x => x.batch === c.batch).map(x => x.ID)
      const held = await db.run(SELECT.one.from(m.Escalations).where({ kind: 'QUALITY_HOLD', consignment_ID: { in: sameBatch } }))
      if (held) return log('ATTACHED', 'batch already escalated')
    }

    const readings = await this.readingsFor(c.ID)
    const legs = c.legs
    const forecast = scenario.project({ consignment: c, signal: s, readings, product, legs, now })
    if (this.gateOn && !forecast.atRisk) {
      return log('LOGGED', isFinite(forecast.minsToBreach)
        ? `lands before breach — arrival in ${fmtDur(forecast.remainingJourneyMins)}, breach in ${fmtDur(forecast.minsToBreach)}`
        : `budget holds — ${forecast.used.above} of ${forecast.budget.above} min used, trajectory ${forecast.slopePerHr ?? 0}°C/hr`, { forecast: brief(forecast) })
    }

    const scope = s.kind === 'QUALITY_HOLD' ? this.feed.live.filter(x => x.batch === c.batch) : [c]
    const dest = this.facById[c.destination_ID]
    const district = this.facilities.filter(f => f.district === dest.district)
    const impact = await inventory.blastRadius(db, scope, district)
    const openCount = (await db.run(SELECT.one`count(*) as n`.from(m.Escalations).where({ state: 'OPEN' }))).n
    if (this.gateOn && !inventory.shouldEscalate(forecast, impact, openCount)) {
      const why = impact.childrenAtRisk === 0 ? `no child at risk — ${impact.coverageNote}` : forecast.probability <= 0.6 ? `probability ${forecast.probability} ≤ 0.6` : 'queue cap of 8 reached'
      return log('LOGGED', why, { forecast: brief(forecast), childrenAtRisk: impact.childrenAtRisk })
    }

    const leg = legs.find(l => !l.exitedAt)
    const memoryQuery = { route: c.route, legKind: leg?.kind, kind: forecast.kind === 'FREEZE' ? 'FREEZE' : forecast.kind === 'SILENT_STALL' ? 'SILENT_STALL' : forecast.kind === 'DWELL' ? 'DWELL' : 'HEAT',
      hourOfDay: new Date(now + 5.5 * 3600000).getUTCHours(), peakTempC: forecast.currentTempC, minutesOut: Math.round(forecast.used.above || 30) }
    const plan = logistics.options({ consignment: c, forecast, impact, readings, product, legs, leg, now, destination: dest, facilities: this.facByCode, memoryQuery })
    forecast.noRecovery = forecast.kind !== 'QUALITY_HOLD' && !forecast.alreadyBreached && plan.recoveryWindowMins == null
    if (forecast.breachAt && plan.recoveryWindowMins != null) forecast.pointOfNoReturn = iso(addMinutes(forecast.breachAt, -plan.recoveryWindowMins))
    forecast.signal = { kind: s.kind, detail: s.detail, direction: s.direction, gap: s.gap, model: s.model && { p95Mins: s.model.p95Mins, medianMins: s.model.medianMins, mode: s.model.mode, samples: s.model.samples } }
    forecast.similar = memory.similar(memoryQuery)
    forecast.rejected = plan.rejected
    forecast.provenance = this.provenance(c, s, forecast, readings, product)

    const escalationId = cds.utils.uuid()
    const options = [
      ...plan.options.map(o => ({ ...o, ...gateOf(o) })),
      ...compliance.dispositions(forecast, product)
    ].map((o, i) => ({
      ID: cds.utils.uuid(), escalation_ID: escalationId, kind: o.kind, label: o.label, detail: o.detail, projectedAt: o.projectedAt || null, actBy: o.actBy || null,
      costInr: o.costInr, confidence: o.confidence, needsQA: !!o.needsQA, verdict: o.verdict, gateReason: o.gateReason, recommended: !!o.recommended,
      rank: o.rank || 100 + i, chosen: false, provenance: JSON.stringify({ ...(o.provenance || {}), durationMins: o.durationMins, saves: o.saves, protectsSessions: o.protectsSessions })
    }))

    const reasoning = narrate({ consignment: c, product, destination: dest, forecast, impact, now, similar: forecast.similar })
    const esc = {
      ID: escalationId, consignment_ID: c.ID, kind: forecast.kind, raisedAt: iso(now), breachAt: forecast.breachAt || impact.earliestAtRisk,
      pointOfNoReturn: forecast.pointOfNoReturn || null, probability: forecast.probability, dosesAtRisk: impact.dosesAtRisk, childrenAtRisk: impact.childrenAtRisk,
      facilitiesCount: impact.facilitiesCount, sessionsCount: impact.sessions, reasoning, state: 'OPEN',
      exposure: exposureScore(forecast, impact, now), forecast: JSON.stringify(forecast), impact: JSON.stringify(impact)
    }
    await db.run(INSERT.into(m.Escalations).entries(esc))
    await db.run(INSERT.into(m.Options).entries(options))
    await db.run(INSERT.into(m.Signals).entries({ ...signal, outcome: 'ESCALATED', reason: `probability ${forecast.probability}, ${impact.childrenAtRisk} children at risk` }))
    const base = { consignment_ID: c.ID }
    await this.ledger({ ...base, agent: 'sensing', stage: 'SIGNAL', payload: { signal: s.kind, detail: s.detail, severity: signal.severity } })
    await this.ledger({ ...base, agent: 'scenario', stage: 'FORECAST', payload: brief(forecast) })
    await this.ledger({ ...base, agent: 'inventory', stage: 'IMPACT', payload: { facilities: impact.facilitiesCount, sessions: impact.sessions, childrenAtRisk: impact.childrenAtRisk, dosesAtRisk: impact.dosesAtRisk } })
    await this.ledger({ ...base, agent: 'logistics', stage: 'OPTIONS', payload: { options: plan.options.map(o => `${o.kind}: ${o.label}`), rejected: plan.rejected } })
    await this.ledger({ ...base, agent: 'compliance', stage: 'GATE', payload: options.map(o => ({ kind: o.kind, verdict: o.verdict, reason: o.gateReason })) })
    await this.ledger({ ...base, agent: 'guardian', stage: 'ESCALATED', payload: { escalation: escalationId, reasoning } })
    LOG.info(`escalated ${c.ref} ${forecast.kind} p=${forecast.probability} children=${impact.childrenAtRisk}`)
  }

  // Open escalations are re-projected every tick, so the countdown is live, not frozen at raise time
  async refreshActive (now) {
    const m = this.m, db = this.db
    const active = await db.run(SELECT.from(m.Escalations).where({ state: { in: ACTIVE } }))
    for (const e of active) {
      const c = this.feed.live.find(x => x.ID === e.consignment_ID)
      if (!c) continue // delivered: the decision record stays as it was
      const f = JSON.parse(e.forecast), impact = JSON.parse(e.impact)
      if (f.kind === 'QUALITY_HOLD') continue
      const readings = await this.readingsFor(c.ID)
      const last = readings.at(-1)
      let sig = { kind: 'EXCURSION', direction: f.kind === 'FREEZE' ? 'FREEZE' : 'HEAT' }
      if (f.kind === 'SILENT_STALL') {
        const gap = Math.round(minutesBetween(last?.at ?? c.departedAt, now))
        sig = gap >= sensing.STALL_GAP ? { kind: 'SILENT_STALL', gap } : { kind: 'EXCURSION', direction: 'HEAT' }
      }
      const next = scenario.project({ consignment: c, signal: sig, readings, product: this.products[c.product_ID], legs: c.legs, now })
      const window = f.breachAt && f.pointOfNoReturn ? minutesBetween(f.pointOfNoReturn, f.breachAt) : null
      const merged = { ...f, ...next, kind: f.kind, signal: f.signal, noRecovery: f.noRecovery, similar: f.similar, rejected: f.rejected, provenance: f.provenance,
        recovered: f.kind !== 'FREEZE' && !isFinite(next.minsToBreach) && !next.alreadyBreached,
        pointOfNoReturn: next.breachAt && window != null ? iso(addMinutes(next.breachAt, -window)) : null }
      if (f.kind === 'FREEZE') Object.assign(merged, { alreadyBreached: true, breachAt: f.breachAt })
      const dest = this.facById[c.destination_ID]
      // once a recovery is approved, the question becomes: does the plan hold?
      let planLine = null
      if (e.state === 'ACTIONED') {
        const chosen = (await db.run(SELECT.from(m.Options).where({ escalation_ID: e.ID, chosen: true }))).find(o => !compliance.DISPOSITION.includes(o.kind))
        const prov = chosen ? JSON.parse(chosen.provenance || '{}') : {}
        if (chosen && prov.saves) {
          const left = minutesBetween(now, chosen.projectedAt)
          const product = this.products[c.product_ID]
          const b = left > 0 ? scenario.burn({ product, used: next.used, from: now, startTemp: last.tempC, slope: scenario.recentSlope(readings), recoverAfter: left }) : null
          merged.plan = { kind: chosen.kind, label: chosen.label, eta: chosen.projectedAt, holds: !b || !isFinite(b.minsToBreach), projectedUse: b ? Math.round(b.above) : next.used.above }
          merged.recovered = left <= 0 && last.tempC <= product.maxTempC
          planLine = left > 0
            ? `${chosen.label} — approved, arriving ${fmtIST(chosen.projectedAt)}. Projected ${merged.plan.projectedUse} of ${next.budget.above} exposure minutes used on arrival: ${merged.plan.holds ? 'the budget holds' : 'the budget will NOT hold — re-plan now'}. Product disposition sits with QA.`
            : `${c.ref} reached the cold room at ${fmtIST(chosen.projectedAt)} and is ${last.tempC <= product.maxTempC ? `back in range at ${last.tempC}°C` : `cooling, now ${last.tempC}°C`}; ${next.used.above} of ${next.budget.above} exposure minutes used. Product disposition sits with QA.`
          if (merged.plan.holds) { merged.probability = 0.1; merged.atRisk = false }
        }
      }
      await db.run(UPDATE(m.Escalations, e.ID).with({
        breachAt: merged.breachAt || impact.earliestAtRisk, pointOfNoReturn: merged.pointOfNoReturn, probability: merged.recovered ? 0.05 : merged.probability,
        forecast: JSON.stringify(merged), exposure: merged.recovered || merged.plan?.holds ? 0 : exposureScore(merged, impact, now),
        reasoning: planLine || (merged.recovered ? `${c.ref} is back in range at ${last?.tempC}°C; the exposure budget holds with ${Math.max(0, merged.budget.above - merged.used.above)} minutes to spare. Product disposition still sits with QA.`
          : narrate({ consignment: c, product: this.products[c.product_ID], destination: dest, forecast: merged, impact, now, similar: f.similar }))
      }))
    }
  }

  // ---------------------------------------------------------------------------
  // The human gate
  // ---------------------------------------------------------------------------
  async _approve (req) {
    const { option: optionId, actor = 'meera', note } = req.data
    const m = this.m, db = this.db
    const o = await db.run(SELECT.one.from(m.Options).where({ ID: optionId }))
    if (!o) return req.reject(404, 'Unknown option')
    const e = await db.run(SELECT.one.from(m.Escalations).where({ ID: o.escalation_ID }))
    if (!ACTIVE.includes(e.state)) return req.reject(409, `Escalation is ${e.state}`)
    // the gate is enforced here, not just greyed out in the UI
    if (o.verdict === 'REQUIRE_QA' && actor !== 'qa') return req.reject(403, 'Product disposition is never automated and never Meera\'s call: it routes to QA')
    if (o.verdict === 'REQUIRE_MEERA' && actor !== 'meera') return req.reject(403, 'Recovery actions are decided by the cold chain coordinator')
    if (o.verdict === 'ADVISORY_ONLY') return req.reject(403, 'Advisory only: outside the policy envelope')
    const siblings = await db.run(SELECT.from(m.Options).where({ escalation_ID: e.ID }))
    const isDisposition = compliance.DISPOSITION.includes(o.kind)
    if (siblings.some(x => x.chosen && compliance.DISPOSITION.includes(x.kind) === isDisposition)) return req.reject(409, isDisposition ? 'Disposition already decided' : 'A recovery action was already approved')

    const now = clock.now()
    await db.run(UPDATE(m.Options, o.ID).with({ chosen: true, decidedBy: actor, decidedAt: iso(now) }))
    // CLOSED once both the recovery (Meera) and the disposition (QA) are decided
    const recoveryDone = !isDisposition || siblings.some(x => x.chosen && !compliance.DISPOSITION.includes(x.kind))
    const dispositionDone = isDisposition || siblings.some(x => x.chosen && compliance.DISPOSITION.includes(x.kind))
    await db.run(UPDATE(m.Escalations, e.ID).with({ state: recoveryDone && dispositionDone ? 'CLOSED' : recoveryDone ? 'ACTIONED' : e.state }))

    const c = await db.run(SELECT.one.from(m.Consignments).where({ ID: e.consignment_ID }))
    const prov = JSON.parse(o.provenance || '{}')
    if (isDisposition) {
      await db.run(UPDATE(m.Consignments, c.ID).with({ disposition: { QUARANTINE: 'QUARANTINED', RELEASE: 'RELEASED', DESTROY: 'DESTROYED' }[o.kind] }))
    } else {
      await respond(this.feed, c.ID, { kind: o.kind, durationMins: prov.durationMins }, now)
    }
    const instruction = instructionFor(o, c, this.facById[c.destination_ID], now, prov)
    const decision = { option: o.kind, label: o.label, actor, at: iso(now), note: note || null, instruction }
    await this.ledger({ consignment_ID: c.ID, agent: 'human', stage: isDisposition ? 'DISPOSITION' : 'DECISION', actor, payload: decision })

    // evidence pack: assembled from the ledger and the forecast, re-written on each decision
    const fresh = await db.run(SELECT.one.from(m.Escalations).where({ ID: e.ID }))
    const forecast = JSON.parse(fresh.forecast), impact = JSON.parse(fresh.impact)
    const decisions = (await db.run(SELECT.from(m.Ledger).where({ consignment_ID: c.ID, stage: { in: ['DECISION', 'DISPOSITION', 'DISMISSED'] } }).orderBy('at'))).map(l => ({ ...JSON.parse(l.payload), stage: l.stage }))
    const allOptions = await db.run(SELECT.from(m.Options).where({ escalation_ID: e.ID }).orderBy('rank'))
    const pack = compliance.evidencePack({ escalation: fresh, consignment: c, product: this.products[c.product_ID], readings: await this.readingsFor(c.ID),
      signal: forecast.signal, forecast, impact, options: allOptions, rejected: forecast.rejected, decision: null })
    pack.generatedAt = iso(now); pack.decisions = decisions
    await db.run(UPDATE(m.Escalations, e.ID).with({ evidence: JSON.stringify(pack) }))
    return JSON.stringify({ ok: true, instruction })
  }

  async _dismiss (req) {
    const { escalation, actor = 'meera', reason } = req.data
    const e = await this.db.run(SELECT.one.from(this.m.Escalations).where({ ID: escalation }))
    if (!e || !ACTIVE.includes(e.state)) return req.reject(409, 'Not open')
    await this.db.run(UPDATE(this.m.Escalations, e.ID).with({ state: 'DISMISSED' }))
    await this.ledger({ consignment_ID: e.consignment_ID, agent: 'human', stage: 'DISMISSED', actor, payload: { reason: reason || 'no reason given', at: iso(clock.now()) } })
    return JSON.stringify({ ok: true })
  }

  // ---------------------------------------------------------------------------
  // Read models for the cockpit
  // ---------------------------------------------------------------------------
  async _overview () {
    const m = this.m, db = this.db, now = clock.now()
    const escs = await db.run(SELECT.from(m.Escalations).columns(e => {
      e.ID, e.kind, e.raisedAt, e.breachAt, e.pointOfNoReturn, e.probability, e.exposure, e.dosesAtRisk, e.childrenAtRisk,
      e.facilitiesCount, e.sessionsCount, e.state, e.consignment(c => { c.ID, c.ref, c.route, c.vehicle, c.batch })
    }).where({ state: { in: ACTIVE } }))
    escs.sort((a, b) => (a.state === 'OPEN' ? 0 : 1) - (b.state === 'OPEN' ? 0 : 1) || Number(b.exposure) - Number(a.exposure))
    const closed = await db.run(SELECT.from(m.Escalations).columns(e => { e.ID, e.kind, e.state, e.raisedAt, e.consignment(c => { c.ref, c.route }) })
      .where({ state: { in: ['CLOSED', 'DISMISSED'] } }).orderBy('raisedAt desc').limit(10))
    const logged = await db.run(SELECT.from(m.Signals).columns(s => { s.ID, s.at, s.kind, s.detail, s.reason, s.mode, s.consignment(c => { c.ref, c.route }) })
      .where({ outcome: 'LOGGED', at: { '>': iso(now - 12 * 3600000) } }).orderBy('at desc').limit(40))
    const open = escs.filter(e => e.state === 'OPEN')
    const needIds = new Set(escs.map(e => e.consignment.ID))
    const routes = routeNames(this.facilities)
    return JSON.stringify({
      clock: clock.status(), gateOn: this.gateOn, autonomyLevel: compliance.POLICY.autonomyLevel,
      live: this.feed.live.length, calm: this.feed.live.filter(c => !needIds.has(c.ID)).length, needYou: open.length,
      escalations: escs.map(e => ({ ...e, probability: Number(e.probability), exposure: Number(e.exposure), routeName: routes[e.consignment.route] })),
      closed, logged, loggedCount: logged.length
    })
  }

  async _detail (escalationId) {
    const m = this.m, db = this.db
    const e = await db.run(SELECT.one.from(m.Escalations).where({ ID: escalationId }))
    if (!e) return JSON.stringify(null)
    const c = await db.run(SELECT.one.from(m.Consignments).where({ ID: e.consignment_ID }))
    const legs = await db.run(SELECT.from(m.Legs).columns('seq', 'kind', 'km', 'enteredAt', 'exitedAt', 'plannedMins', 'movedMins').where({ consignment_ID: c.ID }).orderBy('seq'))
    const options = await db.run(SELECT.from(m.Options).where({ escalation_ID: e.ID }).orderBy('rank'))
    const ledger = await db.run(SELECT.from(m.Ledger).where({ consignment_ID: c.ID }).orderBy('at'))
    const readings = await this.readingsFor(c.ID)
    const product = this.products[c.product_ID]
    return JSON.stringify({
      escalation: { ...e, probability: Number(e.probability), forecast: JSON.parse(e.forecast), impact: JSON.parse(e.impact), evidence: e.evidence ? JSON.parse(e.evidence) : null },
      consignment: c, product, origin: this.facById[c.origin_ID], destination: this.facById[c.destination_ID], legs,
      readings: thin(readings, 360).map(r => [r.at, r.tempC, r.moving ? 1 : 0]),
      options: options.map(o => ({ ...o, confidence: o.confidence == null ? null : Number(o.confidence), provenance: JSON.parse(o.provenance || '{}') })),
      ledger: ledger.map(l => ({ ...l, payload: JSON.parse(l.payload) })),
      routeName: routeNames(this.facilities)[c.route], clock: clock.status()
    })
  }

  // ---------------------------------------------------------------------------
  async readingsFor (id) {
    return (await this.db.run(SELECT.from(this.m.Readings).columns('at', 'tempC', 'moving', 'km', 'legSeq').where({ consignment_ID: id }).orderBy('at'))).map(numR)
  }

  ledger ({ agent, stage, consignment_ID = null, payload, actor = 'agent' }) {
    return this.db.run(INSERT.into(this.m.Ledger).entries({ ID: cds.utils.uuid(), at: iso(clock.now()), agent, stage, consignment_ID, actor, payload: JSON.stringify(payload) }))
  }

  provenance (c, s, f, readings, product) {
    return {
      detection: { detector: s.kind, detail: s.detail, readings: (s.evidence || []).length || null, model: s.model ? `${s.model.mode} P95 ${s.model.p95Mins} min from ${s.model.samples} trips` : null },
      budget: `${product.name}: ${product.budgetMinutesAbove} weighted minutes above ${product.maxTempC}°C, ${product.budgetMinutesBelow >= 100000 ? 'not freeze-sensitive' : `${product.budgetMinutesBelow} below ${product.minTempC}°C`} (illustrative stability data). Weight 1.0 at +1°C rising to ~3.0 at +10°C; freezing ×5.`,
      used: `Consumed so far integrated over ${readings.length} readings since departure.`,
      projection: f.blind ? f.basis : `Least-squares slope over the last 20 min of readings (${f.slopePerHr}°C/hr), capped at ambient, walked forward minute by minute.`,
      arrival: `Remaining journey ${f.remainingJourneyMins} min: planned time for travel still ahead, learned median for handovers (route ${c.route}).`,
      probability: f.kind === 'SILENT_STALL' ? 'Rises with the length of the silence; +0.1 if the blind projection breaches before arrival.' : 'Logistic on (arrival − breach) / σ, σ = 20 min + 25% of time-to-breach.'
    }
  }
}

// ---------------------------------------------------------------------------

const num = p => ({ ...p, minTempC: Number(p.minTempC), maxTempC: Number(p.maxTempC) })
const numR = r => ({ ...r, tempC: Number(r.tempC), km: Number(r.km) })
const gateOf = o => { const g = compliance.gate(o); return { verdict: g.verdict, gateReason: g.reason } }
const brief = f => ({ kind: f.kind, breachAt: f.breachAt, minsToBreach: isFinite(f.minsToBreach) ? Math.round(f.minsToBreach) : null, probability: f.probability, atRisk: f.atRisk, used: f.used, remainingJourneyMins: f.remainingJourneyMins })
const thin = (xs, n) => xs.length <= n ? xs : xs.filter((_, i) => i % Math.ceil(xs.length / n) === 0 || i === xs.length - 1)

function exposureScore (f, impact, now) {
  const deadline = f.pointOfNoReturn || f.breachAt || impact.earliestAtRisk
  const mins = deadline ? Math.max(15, minutesBetween(now, deadline)) : 24 * 60
  return round(f.probability * (impact.childrenAtRisk + impact.dosesAtRisk / 100) * (1 + 120 / mins), 1)
}

function routeNames (facilities) {
  const d = code => facilities.find(f => f.code === code)?.district
  const names = {}
  for (const r of require('../sim/master').ROUTES) {
    names[r.code] = r.kind === 'LONGHAUL' ? `Chennai → ${d(`DS-${r.district}`)}` : `${d(`DS-${r.district}`)} last mile (${r.code.split('-')[1]})`
  }
  return names
}

function instructionFor (o, c, dest, now, prov) {
  const eta = prov.durationMins ? fmtIST(addMinutes(now, prov.durationMins)) : null
  switch (o.kind) {
    case 'DIVERT': return `Transporter ${c.carrier}, vehicle ${c.vehicle}: ${o.label.charAt(0).toLowerCase() + o.label.slice(1)}. ETA ${eta}. Keep doors closed; receiving team notified to transfer to backup reefer.`
    case 'REICE': return `Driver ${c.vehicle}: ${o.label.charAt(0).toLowerCase() + o.label.slice(1)}. ETA ${eta}. Facility pharmacist notified to prepare conditioned ice packs.`
    case 'EXPEDITE': return `${dest.name}: priority goods receipt for ${c.ref} (${c.vehicle}), ETA ${eta}. Driver instructed: no stops.`
    case 'REALLOCATE': return `Buffer transfer requested: ${o.label.replace('Reallocate buffer from ', '')}. Van run scheduled; receiving PHCs notified.`
    case 'REPLACE': return `${o.label}: pick, pack and dispatch ${c.doses.toLocaleString('en-IN')} doses. Transport booked.`
    case 'REPROMISE': return `Facility in-charges and ASHA coordinators notified of the new session date. Families told before they travel.`
    case 'QUARANTINE': return `QA: ${c.ref} batch ${c.batch} to be quarantined on receipt — labelled, segregated, not issued.`
    case 'RELEASE': return `QA: ${c.ref} batch ${c.batch} released for use after VVM check.`
    case 'DESTROY': return `QA: ${c.ref} batch ${c.batch} to be destroyed under witness; replacement to be raised.`
  }
}
