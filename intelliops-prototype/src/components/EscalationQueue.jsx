import { ChevronRight } from 'lucide-react'
import { severity } from '../data/world.js'
import { duration, num, temp, SEVERITY } from '../format.js'

const RING = 2 * Math.PI * 17

function Countdown ({ minutes, tone }) {
  const frac = Math.max(0, Math.min(1, minutes / 480))
  return (
    <span className={`ring tone-${tone}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" width="44" height="44">
        <circle cx="20" cy="20" r="17" className="ring-track" />
        <circle cx="20" cy="20" r="17" className="ring-fill" strokeDasharray={RING} strokeDashoffset={RING * (1 - frac)} />
      </svg>
    </span>
  )
}

export default function EscalationQueue ({ items, selected, onSelect }) {
  return (
    <section className="card queue" aria-labelledby="queue-title">
      <div className="card-head">
        <div>
          <h2 id="queue-title">Escalation queue</h2>
          <p className="muted">Ranked by time left before product is unusable</p>
        </div>
        <span className="chip">{items.filter(c => c.status === 'open').length} open</span>
      </div>

      {items.length === 0 && <p className="empty">No consignment matches your search.</p>}

      <ul className="queue-list">
        {items.map(c => {
          const sev = severity(c)
          const { label, tone } = SEVERITY[sev]
          return (
            <li key={c.id}>
              <button
                className={`queue-item${selected === c.id ? ' is-selected' : ''}`}
                onClick={() => onSelect(c.id)}
                aria-pressed={selected === c.id}
              >
                <Countdown minutes={c.status === 'open' ? c.ttb : 480} tone={tone} />
                <span className="queue-main">
                  <span className="queue-top">
                    <strong className="mono">{c.id}</strong>
                    <span className={`sev tone-${tone}`}>{label}</span>
                  </span>
                  <span className="queue-cause">{c.causeLabel} · {temp(c.temps.at(-1))}</span>
                  <span className="queue-meta">{c.origin} → {c.dest}</span>
                </span>
                <span className="queue-side">
                  <span className={`queue-ttb tone-${tone}`}>{c.status === 'open' ? duration(c.ttb) : c.status === 'mitigating' ? 'Contained' : 'Closed'}</span>
                  <span className="muted small">{num(c.children)} children</span>
                </span>
                <ChevronRight size={16} className="queue-chev" aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
