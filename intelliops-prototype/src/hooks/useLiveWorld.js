import { useCallback, useEffect, useState } from 'react'
import { createWorld, rng, severity, STEP_MIN, HISTORY } from '../data/world.js'

const TICK_MS = 3000 // one simulated minute
const noise = rng(7)

function fmt (ms) {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

function advance (w) {
  const clock = w.clock + 60_000
  const minute = Math.round(clock / 60_000)
  const reading = minute % STEP_MIN === 0
  const consignments = w.consignments.map(c => {
    const open = c.status === 'open'
    const drift = open ? c.trend / STEP_MIN : c.temps.at(-1) > 5 ? -0.05 : 0
    const last = c.temps.at(-1) + drift + (noise() - 0.5) * 0.06
    const temps = reading ? [...c.temps.slice(1 - HISTORY), +last.toFixed(2)] : [...c.temps.slice(0, -1), +last.toFixed(2)]
    return { ...c, temps, ttb: open ? Math.max(0, c.ttb - 1) : c.ttb, progress: Math.min(0.98, c.progress + 0.002) }
  })
  return { ...w, clock, consignments }
}

export function useLiveWorld () {
  const [world, setWorld] = useState(createWorld)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    const t = setInterval(() => setWorld(advance), TICK_MS)
    return () => clearInterval(t)
  }, [paused])

  const log = (w, agent, text) => ({
    ...w,
    activity: [{ id: `a${w.clock}-${w.activity.length}`, agent, text, at: fmt(w.clock) }, ...w.activity].slice(0, 12)
  })

  const approve = useCallback((cid, oid) => {
    setWorld(w => {
      const c = w.consignments.find(x => x.id === cid)
      const o = c?.options.find(x => x.id === oid)
      if (!c || !o) return w
      const next = {
        ...w,
        consignments: w.consignments.map(x => x.id === cid ? { ...x, status: 'mitigating', chosen: oid } : x)
      }
      return log(next, 'Logistics', `Approved “${o.title}” for ${cid}. Driver notified, ETA ${o.eta}`)
    })
  }, [])

  const dismiss = useCallback(cid => {
    setWorld(w => log({
      ...w,
      consignments: w.consignments.map(x => x.id === cid ? { ...x, status: 'dismissed' } : x)
    }, 'Compliance', `${cid} dismissed by coordinator. Reason recorded in ledger`))
  }, [])

  const reset = useCallback(() => setWorld(createWorld()), [])

  return { world, paused, setPaused, approve, dismiss, reset, time: fmt(world.clock), severity }
}

export { fmt as formatTime }
