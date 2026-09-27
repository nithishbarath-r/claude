// Everything user-facing is Indian Standard Time.
const TZ = 'Asia/Kolkata'
const ms = t => (typeof t === 'number' ? t : Date.parse(t))

export const hhmm = t => t ? new Date(ms(t)).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
export const dayShort = t => new Date(ms(t)).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
export const dayName = t => new Date(ms(t)).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'long' })
export const dayHhmm = t => `${dayShort(t)} ${hhmm(t)}`
export const num = n => n == null ? '—' : Number(n).toLocaleString('en-IN')
export const inr = n => n == null ? '—' : n === 0 ? 'no cost' : n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : `₹${(n / 1000).toFixed(1)}k`

export function dur (mins) {
  if (mins == null || !isFinite(mins)) return '—'
  const m = Math.max(0, Math.round(mins)), h = Math.floor(m / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

// countdown with seconds, for the live ticking tiles
export function countdown (toMs, nowMs) {
  const s = Math.round((toMs - nowMs) / 1000)
  if (s <= 0) return null
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(sec).padStart(2, '0')}s`
}

export const KIND_LABEL = {
  HEAT: 'heat excursion', FREEZE: 'freeze event', SILENT_STALL: 'silent stall', DWELL: 'handover dwell', QUALITY_HOLD: 'quality hold'
}
