import { useState } from 'react'
import { countdown, hhmm, num, KIND_LABEL } from './format.js'

const CAP = 8

function deadline (e) {
  // what the big number counts down to
  if (e.kind === 'QUALITY_HOLD' || e.kind === 'FREEZE') return { at: e.breachAt, label: 'to first session' }
  return { at: e.breachAt, label: 'to breach' }
}

function Row ({ e, selected, simNow }) {
  const d = deadline(e)
  const left = d.at ? Date.parse(d.at) - simNow : null
  const cd = d.at ? countdown(Date.parse(d.at), simNow) : null
  const tone = e.state === 'ACTIONED' ? 'actioned' : left != null && left < 3 * 3600000 ? 'urgent' : 'watch'
  return (
    <a className={`qrow ${tone} ${selected ? 'selected' : ''}`} href={`#/c/${e.ID}`}>
      <div className="qrow-head">
        <span className="ref">{e.consignment.ref}</span>
        {e.state === 'ACTIONED' && <span className="chip teal">actioned</span>}
      </div>
      <div className="qrow-sub">{e.routeName} · {KIND_LABEL[e.kind] || e.kind}</div>
      <div className="qrow-main">
        <div className="qrow-count">
          {e.state === 'ACTIONED' && <><span className="big">on plan</span><span className="unit">awaiting arrival · QA</span></>}
          {e.state !== 'ACTIONED' && e.kind === 'FREEZE' && <span className="big">already frozen</span>}
          {e.state !== 'ACTIONED' && e.kind !== 'FREEZE' && (cd ? <><span className="big">{cd}</span><span className="unit">{d.label}</span></> : <span className="big">{d.at ? 'breached' : '—'}</span>)}
        </div>
        <div className="qrow-impact">
          <strong>{num(e.childrenAtRisk)} children</strong>
          <span>{e.facilitiesCount} {e.facilitiesCount === 1 ? 'facility' : 'facilities'} · {num(e.dosesAtRisk)} doses</span>
        </div>
      </div>
      <div className="sevbar" aria-hidden><span style={{ width: `${Math.round(e.probability * 100)}%` }} /></div>
    </a>
  )
}

export default function Queue ({ ov, selected, simNow }) {
  const [showLogged, setShowLogged] = useState(false)
  if (!ov) return <aside className="queue panel"><div className="skeleton" /></aside>
  const open = ov.escalations.filter(e => e.state === 'OPEN')
  const actioned = ov.escalations.filter(e => e.state === 'ACTIONED')
  const shown = open.slice(0, CAP)

  return (
    <aside className="queue panel">
      <div className={`calm ${open.length ? '' : 'all-calm'}`}>
        <div className="calm-num">{num(ov.calm)} tracking normally</div>
        <div className="calm-sub">{open.length === 0 ? 'Nothing needs you. That is what success looks like.' : `${open.length} consignment${open.length > 1 ? 's' : ''} need${open.length > 1 ? '' : 's'} you`}</div>
      </div>

      {!ov.gateOn && <div className="gate-off">Escalation gate is OFF — every signal escalates. This is what alert fatigue looks like.</div>}

      {shown.length > 0 && <div className="eyebrow">Ranked by exposure, not by age</div>}
      <div className="qlist">
        {shown.map(e => <Row key={e.ID} e={e} simNow={simNow} selected={e.ID === selected} />)}
        {open.length > CAP && <div className="more">+{open.length - CAP} more below the cap — the queue never shows more than {CAP}</div>}
      </div>

      {actioned.length > 0 && <>
        <div className="eyebrow muted">Actioned — waiting on arrival or QA</div>
        <div className="qlist">{actioned.map(e => <Row key={e.ID} e={e} simNow={simNow} selected={e.ID === selected} />)}</div>
      </>}

      <div className="logged">
        <button className="linkish" onClick={() => setShowLogged(s => !s)} aria-expanded={showLogged}>
          <span className="pm">{showLogged ? '−' : '+'}</span> {ov.loggedCount} logged, below escalation threshold
        </button>
        <p className="logged-note">Signals the agents saw and judged — each with the reason it did not need you.</p>
        {showLogged && (
          <ul className="logged-list">
            {ov.logged.map(l => (
              <li key={l.ID}>
                <div><span className="mono">{hhmm(l.at)}</span> <strong>{l.consignment.ref}</strong> <span className="muted">{l.consignment.route} · {KIND_LABEL[l.kind === 'EXCURSION' ? 'HEAT' : l.kind] || l.kind}</span>{l.mode && <span className={`chip tiny ${l.mode === 'LEARNED' ? 'teal' : 'amber'}`}>{l.mode}</span>}</div>
                <div className="muted small">{l.detail}</div>
                <div className="small">→ {l.reason}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {ov.closed?.length > 0 && (
        <div className="closed">
          <div className="eyebrow muted">Closed</div>
          {ov.closed.map(c => <a key={c.ID} href={`#/c/${c.ID}`} className={`closed-row ${c.ID === selected ? 'selected' : ''}`}><strong>{c.consignment.ref}</strong> <span className="muted">{KIND_LABEL[c.kind]} · {c.state.toLowerCase()}</span></a>)}
        </div>
      )}

      <div className="why">
        <strong>Why so few?</strong>
        <p>A consignment escalates only when it will breach <em>before it arrives</em> and a child downstream depends on it — buffer stock netted off. The queue is hard-capped at {CAP}. Everything else is logged with its reason.</p>
        <p className="muted small">Autonomy level {ov.autonomyLevel}: agents propose, people decide.</p>
      </div>
    </aside>
  )
}

