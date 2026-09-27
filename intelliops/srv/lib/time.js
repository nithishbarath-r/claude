// Small time helpers. Timestamps travel as ISO strings or epoch millis.

const ms = t => t == null ? null : (typeof t === 'number' ? t : Date.parse(t))
const iso = t => t == null ? null : new Date(ms(t)).toISOString()
const minutesBetween = (a, b) => (ms(b) - ms(a)) / 60000
const addMinutes = (t, m) => ms(t) + m * 60000
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d
const sum = (xs, f = x => x) => xs.reduce((a, x) => a + (f(x) || 0), 0)
const unique = xs => [...new Set(xs)]

// Everything user-facing is Indian Standard Time
const fmtIST = (t, opts = { hour: '2-digit', minute: '2-digit', hour12: false }) =>
  new Date(ms(t)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...opts })
const fmtDur = mins => {
  if (!isFinite(mins)) return 'none in horizon'
  const m = Math.max(0, Math.round(mins)); const h = Math.floor(m / 60)
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

module.exports = { ms, iso, minutesBetween, addMinutes, clamp, round, sum, unique, fmtIST, fmtDur }
