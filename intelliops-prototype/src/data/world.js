// Seeded demo world for the control tower. Deterministic, so every load
// starts from the same state; the live hook advances it from there.

export function rng (seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const SAFE_MIN = 2
export const SAFE_MAX = 8
export const STEP_MIN = 5 // minutes between telemetry readings
export const HISTORY = 48 // 4 hours of readings

const CAUSES = {
  heat: { label: 'Heat excursion', agent: 'Sensing' },
  stall: { label: 'Silent stall', agent: 'Logistics' },
  drift: { label: 'Reefer drift', agent: 'Sensing' },
  door: { label: 'Door-open event', agent: 'Sensing' },
  freeze: { label: 'Freeze risk', agent: 'Sensing' }
}

const SEED = [
  { id: 'CNS-1042', product: 'Pentavalent (DTwP-HepB-Hib)', batch: 'PV-24-0918', origin: 'Chennai RVS', dest: 'PHC Kanchipuram', vehicle: 'TN-09-RF-4471', driver: 'K. Senthil', cause: 'heat', base: 7.4, trend: 0.09, ttb: 118, doses: 4200, children: 380, session: 'Thu 10:00', facilities: 14, progress: 0.46 },
  { id: 'CNS-1017', product: 'Measles-Rubella (MR)', batch: 'MR-24-1102', origin: 'Madurai DVS', dest: 'CHC Sivaganga', vehicle: 'TN-58-RF-2210', driver: 'A. Karthik', cause: 'stall', base: 5.6, trend: 0.02, ttb: 164, doses: 2600, children: 240, session: 'Thu 09:30', facilities: 9, progress: 0.38 },
  { id: 'CNS-1088', product: 'Rotavirus (RVV)', batch: 'RV-24-0776', origin: 'Coimbatore RVS', dest: 'PHC Pollachi', vehicle: 'TN-37-RF-9034', driver: 'R. Prakash', cause: 'drift', base: 6.9, trend: 0.05, ttb: 212, doses: 3100, children: 290, session: 'Fri 11:00', facilities: 11, progress: 0.62 },
  { id: 'CNS-1063', product: 'bOPV', batch: 'OP-24-0451', origin: 'Trichy DVS', dest: 'UPHC Srirangam', vehicle: 'TN-45-RF-1187', driver: 'M. Dinesh', cause: 'freeze', base: 2.6, trend: -0.03, ttb: 276, doses: 5400, children: 510, session: 'Fri 09:00', facilities: 6, progress: 0.21 },
  { id: 'CNS-1125', product: 'PCV-13', batch: 'PC-24-0237', origin: 'Salem DVS', dest: 'PHC Omalur', vehicle: 'TN-30-RF-6620', driver: 'S. Arun', cause: 'door', base: 6.2, trend: 0.03, ttb: 340, doses: 1800, children: 150, session: 'Sat 10:00', facilities: 5, progress: 0.74 },
  { id: 'CNS-1096', product: 'IPV (fractional)', batch: 'IP-24-0690', origin: 'Vellore DVS', dest: 'CHC Arakkonam', vehicle: 'TN-23-RF-3348', driver: 'P. Vignesh', cause: 'drift', base: 6.0, trend: 0.02, ttb: 415, doses: 2200, children: 205, session: 'Sat 09:30', facilities: 7, progress: 0.55 }
]

const OPTIONS = {
  heat: [
    { title: 'Divert to Chengalpattu DVS', detail: '22 km detour · walk-in cold room with 6,000-dose capacity', saves: 1, eta: '+38 min', confidence: 0.91 },
    { title: 'Swap to standby reefer TN-09-RF-5102', detail: 'Rendezvous at Sriperumbudur toll plaza in 26 min', saves: 1, eta: '+52 min', confidence: 0.84 },
    { title: 'Continue and re-promise session', detail: 'Accept loss; move Thursday session to Saturday', saves: 0, eta: '—', confidence: 0.62 }
  ],
  stall: [
    { title: 'Dispatch field officer to vehicle', detail: 'Last GPS ping 41 min ago near Manamadurai', saves: 1, eta: '+25 min', confidence: 0.88 },
    { title: 'Pre-position backup stock at CHC Sivaganga', detail: 'From Madurai DVS surplus, 2,800 doses available', saves: 1, eta: '+95 min', confidence: 0.79 }
  ],
  drift: [
    { title: 'Remote reefer setpoint reset', detail: 'Unit supports telematics command, 3 prior successes on lane', saves: 1, eta: '0 min', confidence: 0.86 },
    { title: 'Transfer to ice-lined refrigerator at PHC Annur', detail: '14 km on route, ILR has 40% free capacity', saves: 1, eta: '+30 min', confidence: 0.81 }
  ],
  freeze: [
    { title: 'Raise reefer setpoint to 5 °C', detail: 'Freeze-sensitive product, shake-test not required yet', saves: 1, eta: '0 min', confidence: 0.93 }
  ],
  door: [
    { title: 'Call driver to confirm door seal', detail: 'Door sensor reported open for 7 min at last stop', saves: 1, eta: '0 min', confidence: 0.9 }
  ]
}

function history (c, r) {
  const pts = []
  let t = c.base - c.trend * HISTORY * 0.9
  for (let i = 0; i < HISTORY; i++) {
    t += c.trend + (r() - 0.5) * 0.28
    if (c.cause === 'door' && i === HISTORY - 9) t += 1.6
    pts.push(+t.toFixed(2))
  }
  return pts
}

export function createWorld () {
  const r = rng(20260928)
  const consignments = SEED.map(c => ({
    ...c,
    causeLabel: CAUSES[c.cause].label,
    agent: CAUSES[c.cause].agent,
    temps: history(c, r),
    status: 'open',
    options: OPTIONS[c.cause].map((o, i) => ({ ...o, id: `${c.id}-O${i + 1}` }))
  }))

  const lanes = [
    { lane: 'CHN → KPM', onTime: 94, excursions: 3 },
    { lane: 'MDU → SVG', onTime: 88, excursions: 5 },
    { lane: 'CBE → PLC', onTime: 97, excursions: 1 },
    { lane: 'TRY → SRG', onTime: 91, excursions: 2 },
    { lane: 'SLM → OML', onTime: 96, excursions: 1 },
    { lane: 'VLR → AKM', onTime: 93, excursions: 2 }
  ]

  const kpiTrend = key => Array.from({ length: 14 }, (_, i) => ({
    i,
    v: {
      active: 188 + Math.round(r() * 18),
      risk: 4 + Math.round(r() * 5),
      doses: 118 + i * 1.8 + r() * 6,
      compliance: 98.2 + r() * 1.4
    }[key]
  }))

  const activity = [
    { id: 'a1', agent: 'Sensing', text: 'Rate of rise on CNS-1042 exceeds lane baseline by 3.1σ', at: '09:42' },
    { id: 'a2', agent: 'Inventory', text: 'Escalated CNS-1042: 380 children booked for Thursday session', at: '09:43' },
    { id: 'a3', agent: 'Logistics', text: 'CNS-1017 stationary 41 min with engine on, no scheduled stop', at: '09:44' },
    { id: 'a4', agent: 'Compliance', text: 'Evidence pack PV-24-0918 prepared for QA review', at: '09:45' },
    { id: 'a5', agent: 'Memory', text: 'Matched CNS-1088 to 4 prior drift events on CBE → PLC', at: '09:46' }
  ]

  return {
    fleet: 200,
    consignments,
    lanes,
    activity,
    kpi: {
      active: kpiTrend('active'),
      risk: kpiTrend('risk'),
      doses: kpiTrend('doses'),
      compliance: kpiTrend('compliance')
    },
    clock: new Date('2026-09-28T09:47:00+05:30').getTime()
  }
}

export function severity (c) {
  if (c.status === 'dismissed') return 'dismissed'
  if (c.status !== 'open') return 'mitigating'
  if (c.ttb <= 150) return 'critical'
  if (c.ttb <= 300) return 'high'
  return 'watch'
}

export const AGENTS = ['Sensing', 'Inventory', 'Logistics', 'Compliance', 'Memory']
