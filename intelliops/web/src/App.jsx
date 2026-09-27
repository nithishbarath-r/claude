import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { hhmm, dayShort } from './format.js'
import Queue from './Queue.jsx'
import Detail from './Detail.jsx'
import Inject from './Inject.jsx'

// Simulated "now", interpolated between polls so countdowns tick smoothly
export function useSimNow (clock) {
  const [, force] = useState(0)
  const anchor = useRef(null)
  useEffect(() => { const t = setInterval(() => force(x => x + 1), 250); return () => clearInterval(t) }, [])
  if (!clock) return Date.now()
  // remember when this clock reading arrived; interpolate from there
  if (anchor.current?.clock !== clock) anchor.current = { at: Date.now(), clock }
  const { at, clock: c } = anchor.current
  return Date.parse(c.now) + (c.paused ? 0 : (Date.now() - at) * c.speed)
}

function useHash () {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => { const f = () => setHash(window.location.hash || '#/'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, [])
  return hash
}

export default function App () {
  const [ov, setOv] = useState(null)
  const [error, setError] = useState(null)
  const [role, setRole] = useState(() => { try { return localStorage.getItem('io-role') || 'meera' } catch { return 'meera' } })
  const [toast, setToast] = useState(null)
  const hash = useHash()
  const selected = hash.startsWith('#/c/') ? hash.slice(4) : null
  const page = hash.startsWith('#/inject') ? 'inject' : 'cockpit'

  const refresh = useCallback(() => api.overview().then(o => { setOv(o); setError(null) }).catch(e => setError(e.message)), [])
  useEffect(() => { refresh(); const t = setInterval(refresh, 1000); return () => clearInterval(t) }, [refresh])
  useEffect(() => { try { localStorage.setItem('io-role', role) } catch {} }, [role])

  // open the most exposed escalation when nothing is selected
  useEffect(() => {
    if (page === 'cockpit' && !selected && ov?.escalations?.length) window.location.replace(`#/c/${ov.escalations[0].ID}`)
  }, [page, selected, ov?.escalations?.[0]?.ID])

  const notify = useCallback((msg, tone = 'ok') => { setToast({ msg, tone, id: Date.now() }) }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t) }, [toast])

  const simNow = useSimNow(ov?.clock)

  return (
    <div className={`app role-${role}`}>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-name">SAP IntelliOps</span>
          <span className="brand-sub">Cold Chain Guardian</span>
        </a>
        <nav className="nav">
          <a className={page === 'cockpit' ? 'on' : ''} href={selected ? `#/c/${selected}` : '#/'}>Cockpit</a>
          <a className={page === 'inject' ? 'on' : ''} href="#/inject">Demo control</a>
        </nav>
        <div className="clock" title="Simulated clock — everything reads time from lib/clock.js">
          <span className="clock-time">{hhmm(simNow)}</span>
          <span className="clock-meta">{dayShort(simNow)} · IST{ov?.clock?.paused ? ' · paused' : ov?.clock?.speed !== 1 ? ` · ${ov?.clock?.speed}×` : ''}</span>
        </div>
        <div className="who" role="group" aria-label="Acting as">
          <button className={role === 'meera' ? 'on' : ''} onClick={() => setRole('meera')} title="Cold chain coordinator — decides recovery actions">
            <span className="avatar meera">MR</span><span className="who-name">Meera Raghavan<small>Coordinator</small></span>
          </button>
          <button className={role === 'qa' ? 'on' : ''} onClick={() => setRole('qa')} title="Quality Assurance — signs product disposition">
            <span className="avatar qa">QA</span><span className="who-name">Dr. S. Iyer<small>Quality Assurance</small></span>
          </button>
        </div>
      </header>

      {error && <div className="banner">Service unreachable: {error}. Is <code>npm start</code> running?</div>}

      {page === 'inject'
        ? <Inject ov={ov} notify={notify} refresh={refresh} />
        : (
          <main className="cockpit">
            <Queue ov={ov} selected={selected} simNow={simNow} />
            <Detail id={selected} role={role} simNow={simNow} notify={notify} refresh={refresh} ov={ov} />
          </main>
        )}

      {toast && <div key={toast.id} className={`toast ${toast.tone}`} role="status">{toast.msg}</div>}
    </div>
  )
}
