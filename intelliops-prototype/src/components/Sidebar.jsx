import { LayoutDashboard, Truck, TriangleAlert, ChartColumn, FileText, Settings, LogOut } from 'lucide-react'
import { AGENTS } from '../data/world.js'

const NAV = [
  { id: 'overview', label: 'Control tower', icon: LayoutDashboard },
  { id: 'shipments', label: 'Shipments', icon: Truck },
  { id: 'alerts', label: 'Escalations', icon: TriangleAlert, badge: true },
  { id: 'analytics', label: 'Analytics', icon: ChartColumn, soon: true },
  { id: 'audit', label: 'Audit ledger', icon: FileText, soon: true }
]

export default function Sidebar ({ page, onNavigate, openCount, open, onClose }) {
  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="Primary">
      <div className="brand">
        <img className="brand-mark" src="/favicon.svg" alt="" width="40" height="40" />
        <div>
          <div className="brand-name">IntelliOps</div>
          <div className="brand-sub">Cold Chain Guardian</div>
        </div>
      </div>

      <nav className="nav">
        <div className="nav-label">Workspace</div>
        {NAV.map(({ id, label, icon: Icon, badge, soon }) => (
          <button
            key={id}
            className={`nav-item${page === id ? ' is-active' : ''}`}
            onClick={() => { onNavigate(id); onClose() }}
            disabled={soon}
            aria-current={page === id ? 'page' : undefined}
          >
            <span className="nav-icon"><Icon size={18} strokeWidth={2} /></span>
            <span className="nav-text">{label}</span>
            {badge && openCount > 0 && <span className="nav-badge">{openCount}</span>}
            {soon && <span className="nav-soon">Soon</span>}
          </button>
        ))}
        <button className="nav-item" disabled>
          <span className="nav-icon"><Settings size={18} strokeWidth={2} /></span>
          <span className="nav-text">Settings</span>
        </button>
      </nav>

      <div className="agents-card">
        <div className="agents-head">
          <span>Agent team</span>
          <span className="live-dot" aria-hidden="true" />
          <span className="agents-status">All online</span>
        </div>
        <ul className="agents-list">
          {AGENTS.map(a => (
            <li key={a}><span className={`agent-pip agent-${a.toLowerCase()}`} />{a}</li>
          ))}
        </ul>
      </div>

      <div className="profile">
        <span className="avatar">MR</span>
        <div className="profile-text">
          <strong>Meera Raghavan</strong>
          <small>Cold chain coordinator</small>
        </div>
        <button className="icon-btn sm" aria-label="Sign out"><LogOut size={16} /></button>
      </div>
    </aside>
  )
}
