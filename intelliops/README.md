# SAP IntelliOps — the cold chain guardian

An agent team that catches a vaccine consignment going wrong **while there is still time to save it**.
HackFest 2026 · Theme 1 — Resilient Supply Chains · RMK College of Engineering and Technology.

IntelliOps watches every in-transit consignment as a live promise to a specific clinic session. It tells the
cold chain coordinator (Meera) which promise is about to break, in how long, and what she can still do about it.
Agents own detection. Humans own disposition.

## Run it

Node.js 20+.

```bash
cd intelliops
npm install
npm run demo          # builds the cockpit, generates the world, serves everything on :4004
```

Then open <http://localhost:4004>. The demo control panel is at <http://localhost:4004/#/inject>.

| Command | What it does |
| --- | --- |
| `npm run setup` | Wipe and regenerate the world (`node sim/generate.js --reset`). Seeded, so it is the same world every time |
| `npm start` | Serve the CAP service, the agent tick and the built cockpit on port 4004 |
| `npm run build` | Build the React cockpit into `app/`, which CAP serves at `/` |
| `npm run dev:web` | Vite dev server on :5173 with hot reload (proxies `/odata` to :4004) |
| `npm test` | Unit tests for the agent logic |

Everything runs on SQLite with no network, including the fonts, so the demo works with Wi-Fi off.

## The four-minute run

| Time | Do | Say |
| --- | --- | --- |
| 0:00 | Queue open and calm | “200 consignments are live. The product's claim is what it does not show you.” |
| 0:40 | Demo control → **Heat excursion** (auto-targets CNS-1042) → **+30 min**. Open CNS-1042 | “Two hours until this batch is unusable. Fourteen facilities downstream. 380 children on Thursday.” |
| 1:40 | Approve the diversion as Meera, switch to QA, sign the disposition, show the evidence pack and ledger | “The agent proposes. Meera decides. QA signs product disposition — that never automates.” |
| 2:30 | **Silent stall** → **+30 min** | “Nothing happened. No temperature crossed a line. That absence is the signal, and no threshold tool can see it.” |
| 3:10 | **No good option** → **+15 min** | “Here it admits there is nothing to save and recommends an honest re-promise.” |

Before the demo, press **Regenerate world** (under 1 second). If a judge asks whether it is scripted,
inject any scenario on a consignment they pick from the dropdown. The agents react to causes; no outcome is scripted.

If a judge presses on alert fatigue, turn the **escalation gate off**. The queue floods, and the three-line
`shouldEscalate` in `srv/agents/inventory.js` is the answer.

## What runs today, and what it becomes

| Layer | This prototype | Production |
| --- | --- | --- |
| Service | SAP CAP (Node.js), `cds-serve` | Same CAP service, deployed to BTP Cloud Foundry |
| Database | SQLite (`db.sqlite`) | HANA Cloud, with the graph and vector engines |
| Sensor feed | Simulator writing a reading every 5 simulated minutes (`sim/feed.js`) | Logger vendor API through an ingestion service |
| ERP data | Seeded master data (`sim/master.js`) | S/4HANA CDS views and Event Mesh events |
| Route memory | Cosine similarity over 5 features (`srv/agents/memory.js`) | HANA Cloud vector engine |
| Explanations | Deterministic sentence template (`srv/lib/explain.js`) | Generative AI Hub, same function signature |
| UI | React cockpit reading the CAP OData service | Fiori elements in the launchpad, plus a Joule skill |
| Approvals | Approve/Sign buttons writing ledger rows; gate enforced server-side | SAP Build Process Automation |
| Identity | Role toggle (Meera / QA), no login | BTP identity (XSUAA) |

**Honest notes for the Q&A**

- Built on SAP CAP. The CDS model and OData service are real and run unchanged on BTP. We did not stand up
  S/4HANA, HANA Cloud, Event Mesh or AI Core. These are the production path, not what runs here.
- **No LLM is called.** Every number is computed deterministically. The reasoning sentence is a template in
  `srv/lib/explain.js`, which is where Generative AI Hub plugs in.
- Stability budgets, costs and distances are illustrative constants and are labelled as such.
- All data is synthetic. Place names are real Tamil Nadu towns; facilities, sessions and numbers are not.
  The only research figures are the Murhekar et al. (Bull. WHO 2013) statistics in the deck.
- We report **no accuracy or wastage-reduction percentage**. Synthetic data cannot evidence one.

## How it works

One loop drives everything (`srv/service.js`, every 2 seconds):

```
clock.now() → feed.step()            simulator writes readings, advances legs
  for each live consignment:
    sensing.detect()                  excursion onset · handover dwell · silent stall · quality hold
    scenario.project()                exposure budget, time to breach — at risk only if it breaches before it arrives
    inventory.blastRadius()           facilities, sessions, children — buffer stock netted off
    shouldEscalate()                  probability > 0.6 AND a child at risk AND fewer than 8 open
    logistics.options()               divert · re-ice · expedite · reallocate · replace · re-promise, each simulated on a copy
    compliance.gate()                 coordinator decides recovery, QA signs disposition, nothing auto-executes
  refresh open escalations            countdowns re-projected every tick
```

### The five agents

| Agent | File | Owns |
| --- | --- | --- |
| Sensing | `srv/agents/sensing.js` | Three detectors, trend-confirmed (three readings, not one) and debounced. The silent stall fires on an **absence** |
| Scenario | `srv/agents/scenario.js` | Exposure budget that drains, weighted by how far out of range; freezing costs ×5. Time to breach, point of no return, probability |
| Inventory | `srv/agents/inventory.js` | Blast radius through the `Serves` link from consignment to session. Children at risk exclude buffered facilities and sessions a replacement could still reach |
| Logistics | `srv/agents/logistics.js` | Options generated from data and simulated on a copy. Infeasible ones are kept with the reason they were rejected |
| Compliance | `srv/agents/compliance.js` | The veto. Release, quarantine and destroy always route to QA. Assembles the evidence pack |

Route memory (`srv/agents/memory.js`) supplies learned dwell models with a **LEARNED / PLANNED** badge (cold-start
honesty: route `TVL-S` has too few trips, so it stays PLANNED) and similar past disruptions.

### The simulated world (`sim/`)

- **History:** 600 closed consignments over 180 days, with three personalities the agents learn from: a chronically
  slow carrier on `CHN-CBE` (handover dwell ×1.8), a seasonal afternoon heat drift on the `CHN-TVL` long haul
  (April–June), and slow goods receipt at the Tiruchirappalli district store. (The guide suggested 90 days; we used
  180 so the April–June pattern is in the learning set.)
- **Live:** 200 consignments in transit, 41 facilities, 204 immunisation sessions over three weeks. Each delivery
  frees a vehicle for its next run, so the live count stays near 200.
- **Injectors** (`sim/inject.js`) add a cause to the world (`SimFaults`, `BatchHolds`), never a signal.
  `sim/respond.js` plays the transporter once a human approves an instruction.
- **Clock** (`srv/lib/clock.js`): nothing else calls `Date.now()`. Default 10× speed, with jump buttons.

### Data model

`db/schema.cds`. The important link is `Serves` (consignment → session): it turns “a batch is at risk” into
“380 children on Thursday”. `Ledger` is append-only and is the audit trail. `Legs.simActualMins` and `SimFaults`
are simulator ground truth; the OData service does not expose `simActualMins`, and no agent reads either.

### OData service

`/odata/v4/cockpit`. All entities are read-only (`$metadata` is browsable). Every write is an action and lands in the ledger:

- `overview()`, `detail(escalation)`, `injectTargets(kind)` — cockpit read models
- `approve(option, actor)`, `dismiss(escalation, actor, reason)` — the human gate
- `inject(kind, ref)`, `clock(op, value)`, `setGate(on)`, `reset()` — demo control

## Project structure

```
intelliops/
  db/schema.cds            entities
  srv/service.cds          the OData service
  srv/service.js           the tick, the human gate, read models
  srv/agents/              sensing, scenario, inventory, logistics, compliance, memory
  srv/lib/                 clock, time helpers, explanation template
  sim/                     master data, physics, generator, live feed, injectors, transporter
  web/                     React cockpit (Queue, Detail, Chart, Inject)
  test/                    agent unit tests
```
