---
description: Run the full local verification gate (types, lint, tests, build)
---

Run the project's verification gate in order and report results honestly. Do not
stop at the first failure — run all four, then summarise.

1. `npm run typecheck`
2. `npm run check` (Biome)
3. `npm test`
4. `npm run build`

For each: report pass/fail with the actual error output on failure. If
everything passes, say so plainly in one line. Do not claim a step passed
without having run it.
