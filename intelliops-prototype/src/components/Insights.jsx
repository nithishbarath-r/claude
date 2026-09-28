import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Bot } from 'lucide-react'

export function FleetHealth ({ fleet, counts, colors }) {
  const data = [
    { name: 'On track', value: fleet - counts.watch - counts.high - counts.critical, color: colors.ok },
    { name: 'Watch', value: counts.watch, color: colors.info },
    { name: 'High', value: counts.high, color: colors.warn },
    { name: 'Critical', value: counts.critical, color: colors.danger }
  ]
  const healthy = ((data[0].value / fleet) * 100).toFixed(1)
  return (
    <section className="card fleet" aria-labelledby="fleet-title">
      <div className="card-head">
        <div>
          <h2 id="fleet-title">Fleet health</h2>
          <p className="muted">{fleet} consignments in transit</p>
        </div>
      </div>
      <div className="donut-wrap">
        <div className="donut-well">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius="70%" outerRadius="92%" paddingAngle={2} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>
                {data.map(d => <Cell key={d.name} fill={d.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center">
            <strong>{healthy}%</strong>
            <span className="muted small">on track</span>
          </div>
        </div>
        <ul className="legend">
          {data.map(d => (
            <li key={d.name}><i style={{ background: d.color }} />{d.name}<strong>{d.value}</strong></li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function ActivityFeed ({ items }) {
  return (
    <section className="card feed" aria-labelledby="feed-title">
      <div className="card-head">
        <div>
          <h2 id="feed-title">Agent activity</h2>
          <p className="muted">What the team noticed and did</p>
        </div>
        <span className="live-tag"><span className="live-dot" aria-hidden="true" /> Live</span>
      </div>
      <ol className="timeline">
        {items.map(a => (
          <li key={a.id}>
            <span className={`tl-icon agent-${a.agent.toLowerCase()}`}><Bot size={14} /></span>
            <div>
              <div className="tl-top"><strong>{a.agent}</strong><span className="muted small mono">{a.at}</span></div>
              <p>{a.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function LaneTick ({ x, y, payload, color }) {
  const [from, to] = payload.value.split(' → ')
  return (
    <text x={x} y={y + 12} textAnchor="middle" fill={color} fontSize={11}>
      <tspan x={x}>{from}</tspan>
      <tspan x={x} dy={13}>→ {to}</tspan>
    </text>
  )
}

function LaneTip ({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <span className="muted small">{label}</span>
      <strong>{payload[0].value}% on time</strong>
      <span className="small">{payload[0].payload.excursions} excursions · 30 d</span>
    </div>
  )
}

export function LanePerformance ({ lanes, colors }) {
  return (
    <section className="card lanes" aria-labelledby="lanes-title">
      <div className="card-head">
        <div>
          <h2 id="lanes-title">Lane performance</h2>
          <p className="muted">On-time delivery, last 30 days · target 95%</p>
        </div>
      </div>
      <div className="chart-well">
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={lanes} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap="28%">
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="lane" tick={<LaneTick color={colors.axis} />} tickLine={false} axisLine={false} interval={0} height={36} />
              <YAxis domain={[80, 100]} tick={{ fill: colors.axis, fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
              <Tooltip content={<LaneTip />} cursor={{ fill: colors.grid }} />
              <Bar dataKey="onTime" radius={[8, 8, 8, 8]} isAnimationActive={false}>
                {lanes.map(l => <Cell key={l.lane} fill={l.onTime >= 95 ? colors.accent : l.onTime >= 90 ? colors.info : colors.warn} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  )
}
