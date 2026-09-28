import { Sparkles, CircleCheck, X } from 'lucide-react'

export default function ActionsPanel ({ c, onApprove, onDismiss }) {
  if (!c) return null
  const decided = c.status !== 'open'
  return (
    <section className="card actions" aria-labelledby="actions-title">
      <div className="card-head">
        <div>
          <h2 id="actions-title"><Sparkles size={18} className="accent-icon" /> Recommended recovery</h2>
          <p className="muted">The agents propose. You decide. QA signs product disposition.</p>
        </div>
      </div>

      <ol className="options">
        {c.options.map((o, i) => {
          const chosen = c.chosen === o.id
          return (
            <li key={o.id} className={`option${chosen ? ' is-chosen' : ''}${decided && !chosen ? ' is-muted' : ''}`}>
              <span className="option-rank">{i + 1}</span>
              <div className="option-body">
                <strong>{o.title}</strong>
                <span className="muted small">{o.detail}</span>
                <div className="option-meta">
                  <span className="confidence" aria-label={`Confidence ${Math.round(o.confidence * 100)}%`}>
                    <span className="confidence-track"><span style={{ width: `${o.confidence * 100}%` }} /></span>
                    {Math.round(o.confidence * 100)}%
                  </span>
                  <span className="small muted">ETA {o.eta}</span>
                  <span className={`small ${o.saves ? 'tone-text-ok' : 'tone-text-warn'}`}>{o.saves ? 'Saves the session' : 'Session re-promised'}</span>
                </div>
              </div>
              {chosen
                ? <span className="approved"><CircleCheck size={16} /> Approved</span>
                : <button className="btn primary" disabled={decided} onClick={() => onApprove(c.id, o.id)}>Approve</button>}
            </li>
          )
        })}
      </ol>

      {!decided && (
        <button className="btn ghost dismiss" onClick={() => onDismiss(c.id)}>
          <X size={14} /> Dismiss as false alarm
        </button>
      )}
      {c.status === 'dismissed' && <p className="muted small">Dismissed. The reason is recorded in the audit ledger.</p>}
    </section>
  )
}
