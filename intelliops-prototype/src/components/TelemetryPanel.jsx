import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Thermometer, Clock, Syringe, Users, Truck, MapPin } from 'lucide-react'
import { SAFE_MIN, SAFE_MAX, STEP_MIN, severity } from '../data/world.js'
import { duration, num, temp, SEVERITY } from '../format.js'

function ChartTip ({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const t = payload[0].value
  const out = t > SAFE_MAX || t < SAFE_MIN
  return (
    <div className="chart-tip">
      <span className="muted small">{label} IST</span>
      <strong className={out ? 'tone-text-danger' : ''}>{temp(t)}</strong>
    </div>
  )
}

export default function TelemetryPanel ({ c, clock, colors }) {
  if (!c) return <section className="card telemetry"><p className="empty">Select a consignment to see its telemetry.</p></section>
  const sev = severity(c)
  const { label, tone } = SEVERITY[sev]
  const now = c.temps.at(-1)
  const data = c.temps.map((t, i) => ({
    t,
    at: new Date(clock - (c.temps.length - 1 - i) * STEP_MIN * 60_000)
      .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  }))
  const stroke = colors[tone] ?? colors.axis

  return (
    <section className="card telemetry" aria-labelledby="tele-title">
      <div className="card-head">
        <div>
          <div className="eyebrow">
            <span className={`sev tone-${tone}`}>{label}</span>
            <span className="muted">{c.causeLabel} · detected by {c.agent} agent</span>
          </div>
          <h2 id="tele-title"><span className="mono">{c.id}</span> · {c.product}</h2>
          <p className="muted">Batch {c.batch} · {num(c.doses)} doses · {c.facilities} facilities downstream</p>
        </div>
      </div>

      <div className="route">
        <span className="route-end"><Truck size={14} /> {c.origin}</span>
        <div className="route-track" role="progressbar" aria-label="Route progress" aria-valuenow={Math.round(c.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="route-fill" style={{ width: `${c.progress * 100}%` }} />
          <div className="route-knob" style={{ left: `${c.progress * 100}%` }} />
        </div>
        <span className="route-end"><MapPin size={14} /> {c.dest}</span>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="well-icon sm"><Thermometer size={16} /></span>
          <div><span className="stat-label">Product temp</span><strong className={now > SAFE_MAX || now < SAFE_MIN ? 'tone-text-danger' : ''}>{temp(now)}</strong></div>
        </div>
        <div className="stat">
          <span className="well-icon sm"><Clock size={16} /></span>
          <div><span className="stat-label">Time to breach</span><strong className={`tone-text-${tone}`}>{c.status === 'open' ? duration(c.ttb) : c.status === 'mitigating' ? 'Contained' : 'Closed'}</strong></div>
        </div>
        <div className="stat">
          <span className="well-icon sm"><Syringe size={16} /></span>
          <div><span className="stat-label">Doses at risk</span><strong>{num(c.doses)}</strong></div>
        </div>
        <div className="stat">
          <span className="well-icon sm"><Users size={16} /></span>
          <div><span className="stat-label">Session · {c.session}</span><strong>{num(c.children)} children</strong></div>
        </div>
      </div>

      <div className="chart-well">
        <div className="chart-legend">
          <span><i className="lg-line" style={{ background: stroke }} /> Product temperature</span>
          <span><i className="lg-band" /> Safe range {SAFE_MIN}–{SAFE_MAX}°C</span>
          <span className="muted">Last 4 h · {STEP_MIN}-min readings</span>
        </div>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="tele-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <ReferenceArea y1={SAFE_MIN} y2={SAFE_MAX} fill={colors.band} ifOverflow="extendDomain" />
              <ReferenceLine y={SAFE_MAX} stroke={colors.danger} strokeDasharray="4 4" strokeOpacity={0.6} />
              <ReferenceLine y={SAFE_MIN} stroke={colors.info} strokeDasharray="4 4" strokeOpacity={0.6} />
              <XAxis dataKey="at" tick={{ fill: colors.axis, fontSize: 11 }} tickLine={false} axisLine={false} interval={11} />
              <YAxis domain={[0, 12]} ticks={[0, 2, 4, 6, 8, 10, 12]} tick={{ fill: colors.axis, fontSize: 11 }} tickLine={false} axisLine={false} unit="°" />
              <Tooltip content={<ChartTip />} cursor={{ stroke: colors.axis, strokeDasharray: '3 3' }} />
              <Area type="monotone" dataKey="t" stroke={stroke} strokeWidth={2.5} fill="url(#tele-fill)" isAnimationActive={false} dot={false} activeDot={{ r: 5, strokeWidth: 3, stroke: colors.surface }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  )
}
