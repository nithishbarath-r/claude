export const duration = m => {
  if (m <= 0) return 'Breached'
  const h = Math.floor(m / 60)
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

export const num = n => n.toLocaleString('en-IN')

export const temp = t => `${t.toFixed(1)}°C`

export const SEVERITY = {
  critical: { label: 'Critical', tone: 'danger' },
  high: { label: 'High', tone: 'warn' },
  watch: { label: 'Watch', tone: 'info' },
  mitigating: { label: 'Mitigating', tone: 'ok' },
  dismissed: { label: 'Dismissed', tone: 'muted' }
}
