import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import Chart from './Chart.jsx'
import { countdown, dayHhmm, dayName, dayShort, dur, hhmm, inr, num, KIND_LABEL } from './format.js'

const DISPOSITION = ['QUARANTINE', 'RELEASE', 'DESTROY']

// every number gets a small expander showing what produced it
function Explain ({ children, label = 'how' }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="explain">
      <button className="explain-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? '−' : '+'} {label}</button>
      {open && <span className="explain-body">{children}</span>}
    </span>
  )
}

function Tile ({ label, value, sub, dark, how }) {
  return (
    <div className={`tile ${dark ? 'dark' : ''}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
      {how && <Explain>{how}</Explain>}
    </div>
  )
}

function Budget ({ f, product }) {
  if (!f?.budget) return null
  const used = Math.min(f.used.above, f.budget.above), pct = Math.min(100, 100 * used / f.budget.above)
  const frozen = product.freezeSensitive && f.used.below > 0
  return (
    <section>
      <h3 className="eyebrow">Exposure budget</h3>
      <div className="budget">
        <div className={`budget-fill ${pct > 80 ? 'hot' : ''}`} style={{ width: `${Math.max(pct, 2)}%` }}>
          {pct > 30 && <span>{Math.round(used)} of {f.budget.above} minutes consumed</span>}
        </div>
        <span className="budget-rest">{pct <= 30 && <strong>{Math.round(used)} of {f.budget.above} consumed · </strong>}{Math.max(0, Math.round(f.budget.above - used))} remaining</span>
      </div>
      {frozen && <div className="budget-freeze">Freeze budget: {f.used.below} of {f.budget.below} weighted minutes — exhausted. Freezing is irreversible for this product.</div>}
      <p className="note">Weighted minutes above {product.maxTempC}°C: 1.0 per minute at +1°C, rising to about 3.0 at +10°C. <Explain label="source">{f.provenance?.budget} {f.provenance?.used}</Explain></p>
    </section>
  )
}

function Downstream ({ impact }) {
  const [all, setAll] = useState(false)
  const facs = all ? impact.facilities : impact.facilities.slice(0, 6)
  return (
    <section>
      <h3 className="eyebrow">Who is downstream</h3>
      <p className="note">{impact.facilitiesCount} facilities · {impact.sessions} sessions · {num(impact.dosesCommitted)} doses committed · {impact.coverageNote}. Sessions after {dayShort(impact.replacementHorizon)} can be resupplied, so they are not counted at risk.</p>
      <table className="down">
        <thead><tr><th>Facility</th><th>Session</th><th>Antigen</th><th className="r">Doses</th><th className="r">Children</th><th>Buffer</th></tr></thead>
        <tbody>
          {facs.flatMap(f => f.sessions.map((s, i) => (
            <tr key={f.code + i} className={s.atRisk ? 'risk' : ''}>
              <td>{i === 0 ? f.name : ''}</td>
              <td>{dayShort(s.date)} {hhmm(s.date)}</td>
              <td>{s.antigen}</td>
              <td className="r mono">{num(s.doses)}</td>
              <td className="r mono">{num(s.children)}</td>
              <td>{s.atRisk ? <span className="chip amber">at risk</span> : s.covered ? <span className="chip teal">covered · {num(f.bufferDoses)}</span> : <span className="chip">later</span>}</td>
            </tr>
          )))}
        </tbody>
      </table>
      {impact.facilities.length > 6 && <button className="linkish" onClick={() => setAll(a => !a)}>{all ? '− fewer' : `+ all ${impact.facilities.length} facilities`}</button>}
    </section>
  )
}

function OptionRow ({ o, role, canAct, onApprove, simNow }) {
  const disp = DISPOSITION.includes(o.kind)
  const yours = disp ? role === 'qa' : role === 'meera'
  const expired = o.actBy && Date.parse(o.actBy) < simNow && !o.chosen
  const p = o.provenance || {}
  return (
    <div className={`opt ${o.recommended ? 'rec' : ''} ${o.chosen ? 'chosen' : ''} ${expired ? 'expired' : ''}`}>
      <div className="opt-main">
        <div className="opt-title">
          {o.chosen ? <span className="chip navy">approved · {o.decidedBy}</span> : o.recommended && <span className="chip teal solid">{disp ? 'recommended' : 'advised'}</span>}
          <strong>{o.label}</strong>
        </div>
        <div className="opt-detail">{o.detail}</div>
        <div className="opt-meta">
          {o.projectedAt && !disp && o.kind !== 'REPROMISE' && <span>arrives {hhmm(o.projectedAt)}</span>}
          {o.actBy && !disp && <span className={expired ? 'late' : ''}>act by {dayHhmm(o.actBy)}</span>}
          {!disp && <span>{inr(o.costInr)}</span>}
          {o.confidence != null && <span>confidence {o.confidence.toFixed(2)}</span>}
          <span className={`gate ${o.verdict}`}>{o.verdict === 'REQUIRE_QA' ? 'QA signs' : o.verdict === 'REQUIRE_MEERA' ? 'coordinator decides' : 'advisory'} — {o.gateReason}</span>
        </div>
        {!disp && (p.simulation || p.similar?.length > 0 || p.record) && (
          <Explain label="what produced this">
            {p.simulation && <>Simulated on a copy: {p.saves ? `the budget holds with ${p.simulation.marginMins} weighted minutes to spare when the product is back in a cold room after ${dur(p.durationMins)}.` : ''} </>}
            {p.protectsSessions && <>Protects the sessions, not the batch. </>}
            {p.record?.n > 0 && <>Route memory: this action saved the batch in {p.record.saved} of {p.record.n} similar past disruptions. </>}
            {p.similar?.length > 0 && <>Closest: {p.similar.map(s => s.summary).join('; ')}. </>}
            Cost figures are illustrative.
          </Explain>
        )}
      </div>
      <div className="opt-act">
        {o.chosen ? <span className="done">✓ {hhmm(o.decidedAt)}</span>
          : yours
            ? <button className="btn" disabled={!canAct} onClick={() => onApprove(o)}>{disp ? 'Sign' : 'Approve'}</button>
            : <span className="locked">{disp ? 'Routed to QA' : 'Coordinator only'}</span>}
      </div>
    </div>
  )
}

function Evidence ({ pack }) {
  if (!pack) return null
  return (
    <section className="evidence" id="evidence">
      <div className="evidence-head">
        <h3 className="eyebrow">Evidence pack</h3>
        <button className="btn ghost" onClick={() => window.print()}>Print</button>
      </div>
      <p className="note">Assembled from the ledger on every decision. This used to take half a day.</p>
      <dl className="ev">
        <dt>Consignment</dt><dd>{pack.consignment} · {pack.product} · batch {pack.batch} · {num(pack.doses)} doses · {pack.vehicle} ({pack.carrier})</dd>
        <dt>Detection</dt><dd>{pack.detection.kind} at {dayHhmm(pack.detection.detectedAt)} — {pack.detection.detail}{pack.detection.model && ` · model ${pack.detection.model.mode}, P95 ${pack.detection.model.p95Mins} min`}</dd>
        <dt>Projection</dt><dd>{pack.projection.breachAt ? `breach ${dayHhmm(pack.projection.breachAt)}` : 'n/a'}{pack.projection.pointOfNoReturn ? ` · recovery closed ${hhmm(pack.projection.pointOfNoReturn)}` : ''} · probability {pack.projection.probability} · {pack.projection.used?.above} of {pack.projection.budget?.above} exposure minutes</dd>
        <dt>Impact</dt><dd>{pack.impact.facilities} facilities · {pack.impact.sessions} sessions · {num(pack.impact.childrenAtRisk)} children at risk</dd>
        <dt>Options</dt><dd>{pack.optionsConsidered.map(o => `${o.chosen ? '✓ ' : ''}${o.label}`).join(' · ')}</dd>
        <dt>Rejected</dt><dd>{pack.optionsRejected?.length ? pack.optionsRejected.map(r => `${r.label}: ${r.reason}`).join(' · ') : 'none'}</dd>
        <dt>Decisions</dt><dd>{pack.decisions.map((d, i) => <div key={i}><span className="mono">{hhmm(d.at)}</span> {d.actor === 'qa' ? 'QA' : 'Meera'} — {d.label}. <span className="muted">{d.instruction}</span></div>)}</dd>
        <dt>Readings</dt><dd>{pack.readings.length} readings, {dayHhmm(pack.readings[0][0])} to {hhmm(pack.readings.at(-1)[0])}</dd>
        <dt>Versions</dt><dd className="mono small">{Object.entries(pack.modelVersions).map(([k, v]) => `${k} ${v}`).join(' · ')} · autonomy level {pack.policy.autonomyLevel}</dd>
      </dl>
    </section>
  )
}

function Ledger ({ rows }) {
  const [open, setOpen] = useState(false)
  return (
    <section>
      <button className="linkish eyebrow-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}><span className="pm">{open ? '−' : '+'}</span> Audit ledger · {rows.length} entries, append-only</button>
      {open && (
        <ol className="ledger">
          {rows.map(l => (
            <li key={l.ID}>
              <span className="mono">{hhmm(l.at)}</span>
              <span className={`who-tag ${l.actor}`}>{l.actor === 'agent' ? l.agent : l.actor}</span>
              <span className="stage">{l.stage}</span>
              <span className="payload">{summarise(l)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function summarise (l) {
  const p = l.payload
  switch (l.stage) {
    case 'SIGNAL': return `${p.signal}: ${p.detail}${p.outcome ? ` → ${p.outcome.toLowerCase()}${p.reason ? `: ${p.reason}` : ''}` : ''}`
    case 'FORECAST': return `breach ${p.breachAt ? hhmm(p.breachAt) : 'n/a'}, p=${p.probability}, arrival in ${dur(p.remainingJourneyMins)}`
    case 'IMPACT': return `${p.facilities} facilities, ${p.sessions} sessions, ${p.childrenAtRisk} children at risk`
    case 'OPTIONS': return `${p.options.length} options; rejected: ${p.rejected.map(r => r.kind).join(', ') || 'none'}`
    case 'GATE': return p.map(x => `${x.kind}→${x.verdict}`).join(', ')
    case 'ESCALATED': return p.reasoning
    case 'DECISION': case 'DISPOSITION': return `${p.label}. ${p.instruction}`
    case 'DISMISSED': return p.reason
    default: return JSON.stringify(p).slice(0, 160)
  }
}

export default function Detail ({ id, role, simNow, notify, refresh, ov }) {
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => id ? api.detail(id).then(setD).catch(() => {}) : setD(null), [id])
  useEffect(() => { setD(null); load(); const t = setInterval(load, 1000); return () => clearInterval(t) }, [load])

  if (!id) {
    return (
      <section className="detail panel empty">
        <div className="empty-inner">
          <div className="empty-num">{ov ? num(ov.calm) : '—'}</div>
          <p>consignments tracking normally. Nothing needs you right now.</p>
          <p className="muted">Nothing visible happening is what success looks like here.</p>
        </div>
      </section>
    )
  }
  if (!d) return <section className="detail panel"><div className="skeleton" /></section>

  const { escalation: e, consignment: c, product, readings, options } = d
  const f = e.forecast, impact = e.impact
  const recovery = options.filter(o => !DISPOSITION.includes(o.kind))
  const disposition = options.filter(o => DISPOSITION.includes(o.kind))
  const recoveryChosen = recovery.some(o => o.chosen), dispositionChosen = disposition.some(o => o.chosen)
  const active = e.state === 'OPEN' || e.state === 'ACTIONED'

  const approve = async o => {
    setBusy(true)
    try { const r = await api.approve(o.ID, role); notify(r.instruction); await load(); refresh() } catch (err) { notify(err.message, 'err') } finally { setBusy(false) }
  }
  const dismiss = async () => {
    const reason = window.prompt('Why is this not a problem? (goes into the ledger)')
    if (!reason) return
    try { await api.dismiss(e.ID, role, reason); notify('Dismissed — reason written to the ledger'); window.location.hash = '#/'; refresh() } catch (err) { notify(err.message, 'err') }
  }

  const breachMs = e.breachAt ? Date.parse(e.breachAt) : null
  const pnrMs = e.pointOfNoReturn ? Date.parse(e.pointOfNoReturn) : null
  const firstSession = impact.earliestAtRisk
  const model = f.signal?.model
  const badge = f.kind === 'SILENT_STALL' ? 'BLIND PROJECTION' : model ? `MODEL: ${model.mode}` : f.similar?.length ? 'ROUTE MEMORY: LEARNED' : null

  let t1
  if (f.kind === 'FREEZE') t1 = <Tile dark label="Potency" value="lost" sub={`frozen ${f.signal?.detail?.split(',')[0] ?? ''}`} how="Freeze-sensitive product below 2°C: the freeze budget is a few minutes and freezing is irreversible, so it is treated as breached whatever it reads now." />
  else if (f.kind === 'QUALITY_HOLD') t1 = <Tile dark label="First session in" value={firstSession ? countdown(Date.parse(firstSession), simNow) || 'now' : '—'} sub={firstSession && `${dayName(firstSession)} ${hhmm(firstSession)}`} how="A held batch cannot be issued. The clock that matters is the first session that depends on it." />
  else t1 = <Tile dark label={f.plan?.holds ? 'Breach' : 'Time to breach'} value={f.plan?.holds || f.recovered ? 'averted' : breachMs ? (countdown(breachMs, simNow) || 'breached') : 'none in 24h'} sub={breachMs && !f.plan?.holds && !f.recovered ? `at ${hhmm(breachMs)}${f.blind ? ' (worst case)' : ''}` : f.plan ? `plan: ${f.plan.label}` : null} how={<>{f.basis} {f.provenance?.projection} Probability {e.probability}: {f.provenance?.probability}</>} />

  return (
    <section className="detail panel">
      <div className="d-head">
        <div>
          <h1>{c.ref} · {product.name.split(' (')[0]}, batch {c.batch}</h1>
          <p className="d-sub">{d.origin.name.replace('State Vaccine Store, ', 'State store, ')} → {d.destination.name} · {c.vehicle} · departed {dayHhmm(c.departedAt)} · promised {dayHhmm(c.promisedAt)}</p>
        </div>
        <div className="d-state">
          <span className={`chip ${e.state === 'OPEN' ? 'amber' : e.state === 'ACTIONED' ? 'teal' : 'navy'}`}>{e.state.toLowerCase()}</span>
          <span className="chip">{KIND_LABEL[e.kind]}</span>
          {active && role === 'meera' && !recoveryChosen && <button className="linkish small" onClick={dismiss}>dismiss…</button>}
        </div>
      </div>

      <div className="tiles">
        {t1}
        <Tile label="Recovery closes" value={f.noRecovery ? 'no window' : pnrMs && !f.plan ? (countdown(pnrMs, simNow) || 'closed') : f.plan ? 'actioned' : '—'}
          sub={pnrMs && !f.plan ? `at ${hhmm(pnrMs)}` : f.noRecovery ? 'no option gets it cold in time' : null}
          how={pnrMs ? 'Breach time minus the longest recovery option still available: act before this and every option is open.' : 'No recovery option saves the product; see what was considered and rejected below.'} />
        <Tile label="Children at risk" value={num(e.childrenAtRisk)} sub={`${impact.atRiskSessions.length} session${impact.atRiskSessions.length === 1 ? '' : 's'}${firstSession ? ` · ${dayName(firstSession)}` : ''}`}
          how="Sessions before a replacement could arrive (48 h after the promised date), at facilities without enough buffer on site. Buffered sessions are netted off." />
        <Tile label="Doses" value={num(e.dosesAtRisk)} sub={f.kind === 'QUALITY_HOLD' ? `${impact.consignmentRefs.length} consignments, one batch` : `${e.facilitiesCount} ${e.facilitiesCount === 1 ? 'facility' : 'facilities'} downstream`} />
      </div>

      <div className="reasoning">
        <p>{e.reasoning}</p>
        <span className="muted small">Narrated from computed numbers — the language is generated, the arithmetic is not.</span>
      </div>

      {f.kind !== 'QUALITY_HOLD' && <section>
        <h3 className="eyebrow">Temperature — readings and projection</h3>
        <Chart readings={readings} forecast={f} product={product} simNow={simNow} badge={badge} />
        <p className="note">Detected: {f.signal?.detail} <Explain>{f.provenance?.detection?.model ? `${f.provenance.detection.model}. ` : ''}{f.provenance?.arrival}</Explain></p>
      </section>}

      {f.kind !== 'QUALITY_HOLD' && <Budget f={f} product={product} />}

      <section>
        <h3 className="eyebrow">Recovery options — simulated</h3>
        {recovery.map(o => <OptionRow key={o.ID} o={o} role={role} simNow={simNow} canAct={active && !busy && !recoveryChosen} onApprove={approve} />)}
        {f.rejected?.length > 0 && (
          <div className="rejected">
            <div className="rejected-title">Considered and rejected</div>
            {f.rejected.map((r, i) => <div key={i} className="rej"><span className="strike">{r.label}</span> — {r.reason}</div>)}
          </div>
        )}
      </section>

      <section className={`qa-zone ${role === 'qa' ? 'is-qa' : ''}`}>
        <h3 className="eyebrow">Product disposition — QA decides</h3>
        {role !== 'qa' && !dispositionChosen && <p className="lockline">Release, quarantine or destroy is never automated, and never the coordinator's call. Switch to the QA view to sign.</p>}
        {disposition.map(o => <OptionRow key={o.ID} o={o} role={role} simNow={simNow} canAct={active && !busy && !dispositionChosen} onApprove={approve} />)}
      </section>

      <Downstream impact={impact} />
      <Evidence pack={e.evidence} />
      <Ledger rows={d.ledger} />
    </section>
  )
}
