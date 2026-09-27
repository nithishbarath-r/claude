import { useEffect, useState } from 'react'
import { api } from './api.js'

const SCENARIOS = [
  { kind: 'HEAT', sees: 'Time-to-breach appears; one chain escalates, three similar ones are logged', then: '+30 min' },
  { kind: 'STALL', sees: 'Detection with no triggering event. The strongest moment', then: '+30 min' },
  { kind: 'FREEZE', sees: 'Severity 1.0 although the temperature looks fine now', then: '+30 min' },
  { kind: 'HOLD', sees: 'Blast radius across several consignments, facilities and sessions', then: 'next tick' },
  { kind: 'NOGOOD', sees: 'Only re-promise survives — and the system says so', then: '+15 min' }
]

function Scenario ({ s, kinds, notify, refresh }) {
  const [targets, setTargets] = useState([])
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => api.targets(s.kind).then(r => setTargets(r.candidates)).catch(() => {})
  useEffect(() => { load() }, [])
  const meta = kinds?.[s.kind] || {}
  const go = async () => {
    setBusy(true)
    try { const r = await api.inject(s.kind, ref); notify(`Injected: ${r.msg}. The agents take it from here.`); refresh(); load() } catch (e) { notify(e.message, 'err') } finally { setBusy(false) }
  }
  return (
    <div className="scn">
      <div className="scn-head"><strong>{meta.label || s.kind}</strong><span className="muted small">then advance {s.then}</span></div>
      <p className="scn-what">{meta.what}</p>
      <p className="small"><span className="muted">Judges see:</span> {s.sees}</p>
      <div className="scn-act">
        <select value={ref} onChange={e => setRef(e.target.value)} onFocus={load} aria-label="Target consignment">
          <option value="">auto — {targets[0]?.ref ?? 'no eligible target'}</option>
          {targets.map(t => <option key={t.ref} value={t.ref}>{t.ref} · {t.route} · {t.product}{t.exposed ? ' · sessions exposed' : ''}</option>)}
        </select>
        <button className="btn" disabled={busy || !targets.length} onClick={go}>Inject</button>
      </div>
    </div>
  )
}

export default function Inject ({ ov, notify, refresh }) {
  const [kinds, setKinds] = useState(null)
  const [resetting, setResetting] = useState(false)
  useEffect(() => { api.targets('HEAT').then(r => setKinds(r.kinds)).catch(() => {}) }, [])
  const clock = async (op, v) => { await api.clock(op, v); refresh() }
  const reset = async () => {
    if (!window.confirm('Regenerate the whole world from the seed? Every decision and ledger row is wiped.')) return
    setResetting(true)
    const t0 = performance.now()
    try { await api.reset(); notify(`World regenerated in ${((performance.now() - t0) / 1000).toFixed(1)} s`); window.location.hash = '#/'; refresh() } catch (e) { notify(e.message, 'err') } finally { setResetting(false) }
  }
  const speed = ov?.clock?.speed, paused = ov?.clock?.paused

  return (
    <main className="inject">
      <div className="inject-intro">
        <h1>Demo control</h1>
        <p>Each button injects a <em>cause</em> into the simulated world — a failed reefer, a dead logger, a recall notice. Nothing here writes a signal or an escalation: the agents react on their own, on whichever consignment you pick.</p>
      </div>

      <section className="controls panel">
        <div className="ctl">
          <div className="eyebrow">Simulated clock</div>
          <div className="btns">
            {paused ? <button className="btn" onClick={() => clock('resume')}>Resume</button> : <button className="btn ghost" onClick={() => clock('pause')}>Pause</button>}
            {[1, 10, 60].map(x => <button key={x} className={`btn ghost ${speed === x ? 'on' : ''}`} onClick={() => clock('speed', x)}>{x}×</button>)}
            <span className="sep" />
            {[15, 30, 60].map(m => <button key={m} className="btn ghost" onClick={() => clock('advance', m)}>+{m} min</button>)}
          </div>
        </div>
        <div className="ctl">
          <div className="eyebrow">Escalation gate</div>
          <div className="btns">
            <button className={`btn ghost ${ov?.gateOn ? 'on' : ''}`} onClick={() => api.setGate(true).then(refresh)}>On</button>
            <button className={`btn ghost ${ov && !ov.gateOn ? 'on warn' : ''}`} onClick={() => api.setGate(false).then(refresh)}>Off — show the flood</button>
          </div>
          <p className="small muted">The answer to the alert-fatigue question: probability &gt; 0.6, a child at risk, and at most 8 open.</p>
        </div>
        <div className="ctl">
          <div className="eyebrow">Reset</div>
          <button className="btn danger" disabled={resetting} onClick={reset}>{resetting ? 'Regenerating…' : 'Regenerate world'}</button>
          <p className="small muted">Same seed, same world. Under 10 seconds.</p>
        </div>
      </section>

      <div className="scns">
        {SCENARIOS.map(s => <Scenario key={s.kind} s={s} kinds={kinds} notify={notify} refresh={refresh} />)}
      </div>

      <section className="script panel">
        <div className="eyebrow">The four-minute run</div>
        <ol>
          <li><strong>0:00</strong> Queue open, calm. “200 consignments are live. The product's claim is what it does not show you.”</li>
          <li><strong>0:40</strong> Heat excursion on CNS-1042, +30 min. Open it. “Two hours until this batch is unusable. Fourteen facilities. 380 children on Thursday.”</li>
          <li><strong>1:40</strong> Approve the diversion, switch to QA, sign the disposition, show the evidence pack. “The agent proposes. Meera decides. QA signs product disposition — that never automates.”</li>
          <li><strong>2:30</strong> Silent stall, +30 min. Pause. “Nothing happened. That absence is the signal, and no threshold tool can see it.”</li>
          <li><strong>3:10</strong> No good option, +15 min. “Here it admits there is nothing to save and recommends an honest re-promise.”</li>
        </ol>
      </section>
    </main>
  )
}
