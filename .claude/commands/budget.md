---
description: Measure the client bundle against the 100 KB first-load budget
---

Build the app and report what a reader actually downloads.

```bash
npm run build && npm run budget
```

`scripts/measure-bundle.mjs` walks Vite's manifest and sums the **static import
closure** of the entry plus one route — the chunks a browser must have before
that page is interactive. That is the number the budget is about.

**Do not total every file in `.output/public/assets`.** That is what this
command used to do, and it measures the whole site including the editor, which
is a number no reader ever pays: it read 280 KB while an article page was
103 KB. A gauge that wrong is a gauge people stop reading.

The budget is **under 100 KB gzipped for an article page**. The write route is
reported too but is not held to it — the editor is an author's screen.

If a chunk looks unexpectedly large, identify what is in it before suggesting a
fix. A server library leaking into the client bundle has happened before and is
the first thing to rule out:

```bash
grep -l "node:crypto\|drizzle-orm\|better-auth/api" .output/public/assets/*.js
```

The editor must never appear on a reader's page; `e2e/articles.spec.ts` asserts
this, and so can you:

```bash
grep -l "tiptap\|ProseMirror" .output/public/assets/*.js
```

Two things that are known and do not need rediscovering:

- Roughly 81 KB of the total is the framework floor — the router,
  `@solidjs/web`, the server-function client, and Paraglide's runtime. Shrinking
  that means giving something up, not tuning something.
- Every route's non-component module sits in the entry graph, so **the entry
  grows with the number of routes** whether or not anybody visits them, at
  roughly 0.5 KB each. That is the trend to watch across phases.

State plainly whether the budget is met. Do not "fix" anything without saying
what you found first.
