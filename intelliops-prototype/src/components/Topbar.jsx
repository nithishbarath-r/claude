import { Search, Bell, Sun, Moon, Pause, Play, Menu } from 'lucide-react'

export default function Topbar ({ title, crumb, time, paused, onPause, theme, onTheme, alerts, query, onQuery, onMenu }) {
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open navigation"><Menu size={18} /></button>
      <div className="titles">
        <div className="crumb">{crumb}</div>
        <h1>{title}</h1>
      </div>

      <label className="search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          placeholder="Search consignment, batch or vehicle"
          value={query}
          onChange={e => onQuery(e.target.value)}
        />
        <kbd>/</kbd>
      </label>

      <div className="top-actions">
        <div className="clock-pill" title="Simulated operations clock (IST)">
          <span className={`live-dot${paused ? ' is-paused' : ''}`} aria-hidden="true" />
          <span className="clock-time">{time}</span>
          <span className="clock-zone">IST</span>
          <button className="icon-btn xs" onClick={onPause} aria-label={paused ? 'Resume live feed' : 'Pause live feed'}>
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </div>
        <button className="icon-btn" onClick={onTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="icon-btn has-badge" aria-label={`${alerts} open escalations`}>
          <Bell size={18} />
          {alerts > 0 && <span className="badge">{alerts}</span>}
        </button>
      </div>
    </header>
  )
}
