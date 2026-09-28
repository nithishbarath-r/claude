import { useEffect, useMemo, useState } from 'react'
import { Truck, TriangleAlert, ShieldCheck, Snowflake, Download, RotateCcw } from 'lucide-react'
import Sidebar from './components/Sidebar.jsx'
import Topbar from './components/Topbar.jsx'
import KpiCard from './components/KpiCard.jsx'
import EscalationQueue from './components/EscalationQueue.jsx'
import TelemetryPanel from './components/TelemetryPanel.jsx'
import ActionsPanel from './components/ActionsPanel.jsx'
import ShipmentsTable from './components/ShipmentsTable.jsx'
import { FleetHealth, ActivityFeed, LanePerformance } from './components/Insights.jsx'
import { useLiveWorld } from './hooks/useLiveWorld.js'
import { severity } from './data/world.js'
import { PALETTE } from './palette.js'

const PAGES = {
  overview: { title: 'Control tower', crumb: 'Operations / Tamil Nadu cold chain' },
  alerts: { title: 'Escalations', crumb: 'Operations / Triage' },
  shipments: { title: 'Shipments', crumb: 'Operations / In transit' }
}

function initialTheme () {
  try {
    const saved = localStorage.getItem('io-theme')
    if (saved) return saved
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App () {
  const { world, paused, setPaused, approve, dismiss, reset, time } = useLiveWorld()
  const [theme, setTheme] = useState(initialTheme)
  const [page, setPage] = useState('overview')
  const [selected, setSelected] = useState('CNS-1042')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)
  const [navOpen, setNavOpen] = useState(false)
  const colors = PALETTE[theme]

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('io-theme', theme) } catch { /* storage unavailable */ }
  }, [theme])

  useEffect(() => {
    const onKey = e => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault()
        document.querySelector('.search input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(t)
  }, [toast])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return world.consignments
      .filter(c => !q || [c.id, c.batch, c.vehicle, c.product, c.origin, c.dest].some(v => v.toLowerCase().includes(q)))
      .toSorted((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || a.ttb - b.ttb)
  }, [world.consignments, query])

  const counts = useMemo(() => {
    const n = { critical: 0, high: 0, watch: 0, mitigating: 0, dismissed: 0 }
    world.consignments.forEach(c => { n[severity(c)]++ })
    return n
  }, [world.consignments])

  const current = world.consignments.find(c => c.id === selected)
  const openCount = counts.critical + counts.high + counts.watch
  const protectedDoses = world.consignments.filter(c => c.status === 'mitigating').reduce((s, c) => s + c.doses, 0)

  const onApprove = (cid, oid) => {
    approve(cid, oid)
    const o = world.consignments.find(c => c.id === cid)?.options.find(x => x.id === oid)
    setToast({ tone: 'ok', text: `${cid}: “${o?.title}” approved. Driver and receiving facility notified.` })
  }
  const onDismiss = cid => {
    dismiss(cid)
    setToast({ tone: 'info', text: `${cid} dismissed. Reason recorded in the audit ledger.` })
  }
  const openConsignment = id => { setSelected(id); setPage('alerts') }

  const triage = (
    <>
      <EscalationQueue items={items} selected={selected} onSelect={setSelected} />
      <div className="stack">
        <TelemetryPanel c={current} clock={world.clock} colors={colors} />
        <ActionsPanel c={current} onApprove={onApprove} onDismiss={onDismiss} />
      </div>
    </>
  )

  return (
    <div className="shell">
      <Sidebar page={page} onNavigate={setPage} openCount={openCount} open={navOpen} onClose={() => setNavOpen(false)} />
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className="main">
        <Topbar
          {...PAGES[page]}
          time={time}
          paused={paused}
          onPause={() => setPaused(p => !p)}
          theme={theme}
          onTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
          alerts={openCount}
          query={query}
          onQuery={setQuery}
          onMenu={() => setNavOpen(true)}
        />

        <main className="content">
          {page === 'overview' && (
            <>
              <div className="toolbar">
                <p className="toolbar-summary">
                  <strong>{openCount} signals</strong> across {world.fleet} consignments · 6 districts · updated {time} IST
                </p>
                <div className="toolbar-actions">
                  <button className="btn" onClick={reset}><RotateCcw size={15} /> Reset demo</button>
                  <button className="btn primary" onClick={() => window.print()}><Download size={15} /> Export report</button>
                </div>
              </div>

              <div className="kpis">
                <KpiCard icon={Truck} label="Active consignments" value={world.fleet} delta={3.2} good="up" series={world.kpi.active} color={colors.accent} />
                <KpiCard icon={TriangleAlert} label="At risk now" value={counts.critical + counts.high} delta={-12.5} good="down" series={world.kpi.risk} color={colors.danger} tone="danger" />
                <KpiCard icon={ShieldCheck} label="Doses protected" value={((142_600 + protectedDoses) / 1000).toFixed(1)} unit="k" delta={8.4} good="up" series={world.kpi.doses} color={colors.ok} tone="ok" />
                <KpiCard icon={Snowflake} label="Temperature compliance" value="99.1" unit="%" delta={0.6} good="up" series={world.kpi.compliance} color={colors.info} tone="info" />
              </div>
            </>
          )}

          {page === 'shipments'
            ? <ShipmentsTable items={items} onOpen={openConsignment} />
            : <div className="grid-triage">{triage}</div>}

          {page === 'overview' && (
            <div className="grid-insights">
              <LanePerformance lanes={world.lanes} colors={colors} />
              <FleetHealth fleet={world.fleet} counts={counts} colors={colors} />
              <ActivityFeed items={world.activity} />
            </div>
          )}

          <footer className="foot">
            <span>IntelliOps · SAP BTP prototype · Simulated data</span>
            <span>Agents detect. People decide. QA signs.</span>
          </footer>
        </main>
      </div>

      <div className="toast-region" role="status" aria-live="polite">
        {toast && <div key={toast.text} className={`toast tone-${toast.tone}`}>{toast.text}</div>}
      </div>
    </div>
  )
}
