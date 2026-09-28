# IntelliOps · Cold Chain Control Tower

A neumorphic operations dashboard for the IntelliOps cold chain guardian. It runs entirely on seeded,
simulated data, so it needs no backend.

```bash
npm install
npm run dev      # http://localhost:5173
npm run lint
npm run build
```

## What is on screen

| Area | What it does |
| --- | --- |
| **Control tower** | KPI cards with 14-day sparklines, the escalation queue, live telemetry for the selected consignment, recommended recovery options, lane performance, fleet health and the agent activity feed |
| **Escalations** | The triage view on its own: queue, telemetry and recovery options |
| **Shipments** | A table of every monitored consignment, filterable by severity. Clicking a row opens it in triage |

The simulated clock advances one minute every 3 seconds. Countdowns tick, temperatures drift and a new
reading is added every 5 simulated minutes. Pause it from the clock in the top bar, or reset it from
**Reset demo**.

**Approve** on a recovery option contains the consignment and logs the decision. **Dismiss as false alarm**
closes it. Both actions show up in the activity feed. Press `/` to jump to search. The light and dark themes
follow your system setting, and your choice is remembered.

## Structure

```
src/
  App.jsx                  page shell, routing between views, theme
  index.css                design system: tokens, raised and pressed surfaces, layout, responsive rules
  palette.js               chart colours per theme (SVG attributes can't read CSS variables)
  format.js                duration, number and severity formatting
  data/world.js            seeded consignments, lanes, KPIs and agent activity
  hooks/useLiveWorld.js    the simulated clock and the approve, dismiss and reset actions
  components/              Sidebar, Topbar, KpiCard, EscalationQueue, TelemetryPanel,
                           ActionsPanel, ShipmentsTable, Insights (lanes, fleet, activity)
```

## Design notes

- **One surface colour.** Every element is either raised from the surface or pressed into it. Raised means
  something you can act on (cards, buttons, queue items). Pressed means a container or input (charts,
  search, tracks, the selected item).
- **Colour carries meaning only.** Red is critical, amber is high, blue is watch, green is contained, and
  indigo is for actions.
- **Accessibility.** Focus rings are visible, the live region announces toasts, and animation is disabled
  under `prefers-reduced-motion`.
- **Responsive.** Below 960px the sidebar becomes a drawer. Below 640px the KPIs sit two to a row.
