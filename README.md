# SAP IntelliOps — HackFest 2026

The cold chain guardian: an agent team on SAP CAP that catches a vaccine consignment going wrong while there is still time to save it.

The prototype lives in [`intelliops/`](intelliops/README.md). To run it:

```bash
cd intelliops && npm install && npm run demo   # then open http://localhost:4004
```

[`intelliops-prototype/`](intelliops-prototype/README.md) is a standalone neumorphic control-tower UI (Vite + React, simulated data): `cd intelliops-prototype && npm install && npm run dev`.

`.agents/skills` and `.claude/skills` hold the design skills installed from `Leonxlnx/taste-skill`.
