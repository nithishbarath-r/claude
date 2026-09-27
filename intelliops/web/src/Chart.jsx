import { hhmm } from './format.js'

// The one chart that carries the technical argument: readings, the 2–8°C band,
// and the projection drawn dashed to the predicted breach point.
export default function Chart ({ readings, forecast, product, simNow, badge }) {
  const W = 760, H = 280, L = 44, R = 96, T = 30, B = 34
  const pts = readings.map(([at, t, moving]) => ({ x: Date.parse(at), y: t, moving }))
  if (!pts.length) return <div className="chart-empty">No readings yet</div>
  const series = (forecast?.series || []).map(s => ({ x: Date.parse(s.at), y: s.tempC }))
  const breachX = forecast?.breachAt ? Date.parse(forecast.breachAt) : null
  const showProj = series.length && !forecast.recovered && !forecast.plan?.holds
  const proj = showProj ? series.filter(p => !breachX || p.x <= breachX + 60000) : []

  const x0 = Math.max(pts[0].x, simNow - 8 * 3600000)
  const x1 = Math.max(simNow + 20 * 60000, proj.length ? proj.at(-1).x : 0, breachX && breachX - simNow < 6 * 3600000 ? breachX + 10 * 60000 : 0)
  const vis = pts.filter(p => p.x >= x0)
  const ys = [...vis.map(p => p.y), ...proj.map(p => p.y), product.minTempC - 1, product.maxTempC + 3]
  const y0 = Math.floor(Math.min(...ys) - 0.5), y1 = Math.ceil(Math.max(...ys) + 0.5)
  const sx = x => L + (x - x0) / (x1 - x0) * (W - L - R)
  const sy = y => T + (y1 - y) / (y1 - y0) * (H - T - B)
  const path = ps => ps.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')

  const last = vis.at(-1)
  const projPath = proj.length && last ? path([last, ...proj]) : null
  const breachPt = proj.length && breachX ? proj.find(p => p.x >= breachX - 60000) || proj.at(-1) : null
  const gap = forecast?.kind === 'SILENT_STALL' && !forecast.recovered
  const ticks = []
  const step = (x1 - x0) > 6 * 3600000 ? 2 * 3600000 : 3600000
  for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) ticks.push(t)
  const yTicks = [...new Set([y0, product.minTempC, product.maxTempC, y1].filter(v => v >= y0 && v <= y1))]

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Temperature readings and projection">
      <rect x={L} y={sy(product.maxTempC)} width={W - L - R} height={sy(product.minTempC) - sy(product.maxTempC)} className="band" />
      <line x1={L} x2={W - R} y1={sy(product.maxTempC)} y2={sy(product.maxTempC)} className="band-edge" />
      <line x1={L} x2={W - R} y1={sy(product.minTempC)} y2={sy(product.minTempC)} className="band-edge" />
      <text x={W - R + 6} y={sy(product.maxTempC) + 14} className="band-label">safe {product.minTempC}–{product.maxTempC}°C</text>
      {yTicks.map(v => <text key={v} x={L - 8} y={sy(v) + 4} className="axis" textAnchor="end">{v}°</text>)}
      {ticks.map(t => <text key={t} x={sx(t)} y={H - 10} className="axis" textAnchor="middle">{hhmm(t)}</text>)}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="baseline" />

      {/* stationary periods */}
      {vis.filter(p => !p.moving).map((p, i) => <rect key={i} x={sx(p.x) - 2} y={H - B} width={4} height={4} className="stationary" />)}

      <path d={path(vis)} className="line" />
      {gap && last && <line x1={sx(last.x)} x2={sx(simNow)} y1={sy(last.y)} y2={sy(last.y)} className="gap" />}
      {gap && last && <text x={(sx(last.x) + sx(simNow)) / 2} y={sy(last.y) + 18} className="gap-label" textAnchor="middle">no data</text>}
      {projPath && <path d={projPath} className="proj" />}
      {breachPt && <>
        <circle cx={sx(breachPt.x)} cy={sy(breachPt.y)} r="6" className="breach-dot" />
        <text x={sx(breachPt.x)} y={Math.max(14, sy(breachPt.y) - 14)} textAnchor="end" className="breach-label">BREACH {hhmm(breachX)}</text>
      </>}

      <line x1={sx(simNow)} x2={sx(simNow)} y1={T - 8} y2={H - B} className="now" />
      <text x={sx(simNow)} y={T - 12} textAnchor="middle" className="now-label">NOW {hhmm(simNow)}</text>
      {last && <>
        <circle cx={sx(last.x)} cy={sy(last.y)} r="4.5" className="last-dot" />
        <text x={sx(last.x) + 8} y={sy(last.y) - 8} className="last-label">{last.y}°C</text>
      </>}
      {badge && <g transform={`translate(${L + 10}, ${T - 6})`}>
        <rect width={badge.length * 7.2 + 18} height="20" rx="10" className={`badge-bg ${badge.startsWith('MODEL: PLANNED') || badge.startsWith('BLIND') ? 'amber' : ''}`} />
        <text x="9" y="14" className="badge-text">{badge}</text>
      </g>}
    </svg>
  )
}

