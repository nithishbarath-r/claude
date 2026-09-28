import { useState } from 'react'
import { severity } from '../data/world.js'
import { duration, num, temp, SEVERITY } from '../format.js'

const FILTERS = ['all', 'critical', 'high', 'watch', 'mitigating', 'dismissed']

export default function ShipmentsTable ({ items, onOpen }) {
  const [filter, setFilter] = useState('all')
  const rows = items.filter(c => filter === 'all' || severity(c) === filter)
  return (
    <section className="card table-card" aria-labelledby="ship-title">
      <div className="card-head">
        <div>
          <h2 id="ship-title">Monitored consignments</h2>
          <p className="muted">Consignments with an active agent signal</p>
        </div>
        <div className="segmented" role="tablist" aria-label="Filter by severity">
          {FILTERS.map(f => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : SEVERITY[f].label}
            </button>
          ))}
        </div>
      </div>
      <div className="table-well">
        <table>
          <thead>
            <tr>
              <th>Consignment</th><th>Product</th><th>Route</th><th>Vehicle</th>
              <th className="num">Temp</th><th className="num">Doses</th><th>Time to breach</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const { label, tone } = SEVERITY[severity(c)]
              return (
                <tr key={c.id} onClick={() => onOpen(c.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen(c.id)}>
                  <td className="mono strong">{c.id}</td>
                  <td>{c.product}<div className="muted small">{c.batch}</div></td>
                  <td>{c.origin} → {c.dest}</td>
                  <td className="mono">{c.vehicle}<div className="muted small">{c.driver}</div></td>
                  <td className="num">{temp(c.temps.at(-1))}</td>
                  <td className="num">{num(c.doses)}</td>
                  <td className={`tone-text-${tone}`}>{c.status === 'open' ? duration(c.ttb) : label}</td>
                  <td><span className={`sev tone-${tone}`}>{label}</span></td>
                </tr>
              )
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="empty">Nothing in this view.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
