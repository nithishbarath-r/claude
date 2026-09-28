import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

export default function KpiCard ({ icon: Icon, label, value, unit, delta, good, series, color, tone = 'accent' }) {
  const up = delta >= 0
  const positive = good === 'up' ? up : !up
  const gid = `spark-${label.replace(/\W/g, '')}`
  return (
    <article className={`card kpi tone-${tone}`}>
      <div className="kpi-head">
        <span className="well-icon"><Icon size={18} /></span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">
        {value}{unit && <span className="kpi-unit">{unit}</span>}
      </div>
      <div className="kpi-foot">
        <span className={`delta ${positive ? 'is-good' : 'is-bad'}`}>
          {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {Math.abs(delta)}%
        </span>
        <span className="muted">vs last week</span>
      </div>
      <div className="spark" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${gid})`} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </article>
  )
}
