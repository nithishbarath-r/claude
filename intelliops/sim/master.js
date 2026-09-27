// Master data: the stand-in for the S/4HANA extract, plus the distance lookup table.
// Place names are real Tamil Nadu towns; every number here is synthetic and illustrative.

const PRODUCTS = [
  // budgets are illustrative — real ones come from manufacturers' stability data
  { code: 'PENTA', name: 'Pentavalent (DTwP-HepB-Hib)', minTempC: 2, maxTempC: 8, freezeSensitive: true, budgetMinutesAbove: 300, budgetMinutesBelow: 5 },
  { code: 'MR', name: 'Measles-Rubella', minTempC: 2, maxTempC: 8, freezeSensitive: false, budgetMinutesAbove: 150, budgetMinutesBelow: 100000 },
  { code: 'HEPB', name: 'Hepatitis B', minTempC: 2, maxTempC: 8, freezeSensitive: true, budgetMinutesAbove: 420, budgetMinutesBelow: 5 },
  { code: 'RVV', name: 'Rotavirus (RVV)', minTempC: 2, maxTempC: 8, freezeSensitive: true, budgetMinutesAbove: 240, budgetMinutesBelow: 5 }
]

// Weekly session day per facility (2 = Tuesday, 4 = Thursday), catchment children per session,
// buffer doses held on site, and distance from the district store in km.
const PHCS = {
  MDU: [
    ['Melur', 4, 120, 0, 28], ['Thirumangalam', 4, 135, 0, 20], ['Usilampatti', 4, 150, 600, 40],
    ['Vadipatti', 4, 125, 0, 26], ['Peraiyur', 4, 110, 450, 48], ['Kottampatti', 4, 95, 400, 42],
    ['Sholavandan', 4, 105, 380, 22], ['Alanganallur', 2, 115, 0, 18], ['Kallikudi', 2, 90, 300, 30],
    ['T. Kallupatti', 2, 100, 0, 38], ['Chellampatti', 2, 85, 250, 45], ['Sedapatti', 2, 80, 0, 55],
    ['Thiruparankundram', 2, 140, 500, 9]
  ],
  CBE: [
    ['Pollachi', 4, 150, 500, 40], ['Mettupalayam', 2, 130, 0, 36], ['Sulur', 4, 110, 300, 18],
    ['Annur', 2, 95, 0, 30], ['Karamadai', 4, 90, 250, 28], ['Kinathukadavu', 2, 100, 0, 25],
    ['Madukkarai', 4, 85, 200, 14]
  ],
  TRY: [
    ['Manapparai', 4, 130, 400, 40], ['Musiri', 2, 110, 0, 38], ['Lalgudi', 4, 120, 300, 20],
    ['Thuraiyur', 2, 105, 0, 45], ['Srirangam', 4, 140, 350, 8], ['Manachanallur', 2, 90, 0, 22]
  ],
  // Tirunelveli: small, remote PHCs with almost no buffer — where there is no good option
  TVL: [
    ['Nanguneri', 2, 95, 0, 40], ['Ambasamudram', 4, 110, 0, 58], ['Radhapuram', 2, 85, 0, 72],
    ['Valliyur', 4, 100, 0, 62]
  ]
}

const DISTRICTS = {
  MDU: { name: 'Madurai', km: 460 },
  CBE: { name: 'Coimbatore', km: 505 },
  TRY: { name: 'Tiruchirappalli', km: 330 },
  TVL: { name: 'Tirunelveli', km: 620 }
}

function facilities () {
  const out = [{ code: 'SS-CHN', name: 'State Vaccine Store, Chennai', kind: 'STATE_STORE', district: 'Chennai', bufferDoses: 200000, powerRisk: 'LOW', coldRoom: true }]
  for (const [d, meta] of Object.entries(DISTRICTS)) {
    out.push({ code: `DS-${d}`, name: `District Store, ${meta.name}`, kind: 'DISTRICT_STORE', district: meta.name, bufferDoses: d === 'TVL' ? 0 : 20000, // Tirunelveli store is stocked out: single-source
      powerRisk: 'LOW', coldRoom: true })
    out.push({ code: `GH-${d}`, name: `Govt Hospital, ${meta.name}`, kind: 'HOSPITAL', district: meta.name, bufferDoses: d === 'TVL' ? 0 : 800, powerRisk: 'LOW', coldRoom: true, sessionDay: 4, children: 160, kmFromDS: 5 })
    for (const [name, day, children, buffer, km] of PHCS[d]) {
      out.push({
        code: `PHC-${d}-${name.replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase()}`,
        name: `PHC ${name}`, kind: 'PHC', district: meta.name, bufferDoses: buffer,
        powerRisk: buffer === 0 ? 'HIGH' : (km > 35 ? 'MEDIUM' : 'LOW'),
        coldRoom: false, sessionDay: day, children, kmFromDS: km
      })
    }
  }
  // corridor hospitals — divert points only, outside the four districts
  out.push({ code: 'GH-VPM', name: 'Govt Hospital, Villupuram', kind: 'HOSPITAL', district: 'Villupuram', bufferDoses: 0, powerRisk: 'LOW', coldRoom: true })
  out.push({ code: 'GH-SLM', name: 'Govt Hospital, Salem', kind: 'HOSPITAL', district: 'Salem', bufferDoses: 0, powerRisk: 'LOW', coldRoom: true })
  return out
}

// Routes. Long-haul: State store -> district store. Last-mile: district store -> PHC cluster.
// `stops` are cold points along the corridor (km from origin) — the divert lookup table.
const LONGHAUL_SPEED = 52 // km/h including stops
const LASTMILE_SPEED = 35

const ROUTES = [
  { code: 'CHN-MDU', kind: 'LONGHAUL', district: 'MDU', km: 460, carrier: 'Pandian Cold Logistics', stops: [['GH-VPM', 160], ['DS-TRY', 330], ['GH-TRY', 334]] },
  { code: 'CHN-TVL', kind: 'LONGHAUL', district: 'TVL', km: 620, carrier: 'Pandian Cold Logistics', stops: [['GH-VPM', 160], ['DS-TRY', 330], ['DS-MDU', 460], ['GH-MDU', 463]] },
  { code: 'CHN-TRY', kind: 'LONGHAUL', district: 'TRY', km: 330, carrier: 'Coromandel Reefers', stops: [['GH-VPM', 160]] },
  // the chronically slow carrier — handover dwell runs 1.8x the others
  { code: 'CHN-CBE', kind: 'LONGHAUL', district: 'CBE', km: 505, carrier: 'Kovai Reefer Lines', slowCarrier: 1.8, stops: [['GH-SLM', 340]] },
  { code: 'MDU-N', kind: 'LASTMILE', district: 'MDU', cluster: 0 },
  { code: 'MDU-S', kind: 'LASTMILE', district: 'MDU', cluster: 1 },
  { code: 'CBE-N', kind: 'LASTMILE', district: 'CBE', cluster: 0 },
  { code: 'CBE-S', kind: 'LASTMILE', district: 'CBE', cluster: 1 },
  { code: 'TRY-E', kind: 'LASTMILE', district: 'TRY', cluster: 0 },
  { code: 'TRY-W', kind: 'LASTMILE', district: 'TRY', cluster: 1 },
  { code: 'TVL-N', kind: 'LASTMILE', district: 'TVL', cluster: 0 },
  // opened three weeks ago — too few trips to learn from, so its models stay PLANNED
  { code: 'TVL-S', kind: 'LASTMILE', district: 'TVL', cluster: 1, newRoute: true }
]

// Planned leg templates. Dock legs are dwell; travel legs are km / speed.
function plannedLegs (route, destKm) {
  if (route.kind === 'LONGHAUL') {
    return [
      { kind: 'DISPATCH', km: 0, plannedMins: 45 },
      { kind: 'LONGHAUL', km: route.km, plannedMins: Math.round(route.km / LONGHAUL_SPEED * 60) },
      { kind: 'HANDOVER', km: 0, plannedMins: 90 } // goods receipt at the district store
    ]
  }
  return [
    { kind: 'DISPATCH', km: 0, plannedMins: 40 },
    { kind: 'LASTMILE', km: destKm, plannedMins: Math.round(destKm / LASTMILE_SPEED * 60) + 10 },
    { kind: 'HANDOVER', km: 0, plannedMins: 20 } // receipt into the PHC's ice-lined refrigerator
  ]
}

// The personalities baked into history (see the build guide, step 1)
function dwellFactor (route, legKind, destCode) {
  let f = 1
  if (route.slowCarrier && (legKind === 'DISPATCH' || legKind === 'HANDOVER')) f *= route.slowCarrier
  if (route.code === 'CHN-TRY' && legKind === 'HANDOVER') f *= 2.2 // one plant with slow goods receipt
  return f
}

module.exports = { PRODUCTS, DISTRICTS, ROUTES, facilities, plannedLegs, dwellFactor, LONGHAUL_SPEED, LASTMILE_SPEED }
