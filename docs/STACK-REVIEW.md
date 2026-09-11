# Stack review — evolve, don't rewrite

_Reviewed: September 2026, against the existing `main` (5 commits, ~2500 LOC)._

## Verdict

**Evolve the repo. Do not rewrite.**

Every decision that is expensive to reverse is already correct: PostgreSQL + Drizzle,
Better Auth with the Drizzle adapter, TanStack Start server functions, path-prefix i18n
routing (`/$lang/...`), and locale negotiation by cookie then `Accept-Language`. Phase 1
auth is the hardest part of this application and it is done and coherent.

A rewrite would reproduce the same architecture at the cost of several weeks. What the
repo needs instead is four targeted replacements and a dependency discipline pass.

## The one hard requirement: first-load speed

The stated deal-breaker is that someone who just heard about KLE opens the site and waits.
That is a *bytes over a slow mobile link* problem, not a framework problem — Haitian mobile
data is slow, metered and expensive. Solid + SSR already gives an excellent baseline. The
work is keeping it.

**Budget: an article page must render in under 100 KB transferred on first visit**
(HTML + CSS + JS + fonts, excluding images), enforced in CI.

The four things that actually decide whether we hit it:

1. **Compile-time i18n.** Going to four locales with a runtime dictionary means shipping
   four dictionaries. Paraglide compiles messages to ESM functions that the bundler
   tree-shakes, so bundle size is constant no matter how many messages exist.
2. **The editor must never reach readers.** TipTap/ProseMirror is 100–200 KB. Route-split
   it so only `/write` and `/review` load it. This is the single biggest win available.
3. **Images, not JavaScript, are usually the bill.** AVIF/WebP, responsive `srcset`,
   explicit dimensions, lazy-load below the fold.
4. **Subset the fonts.** We need Latin plus the Creole and French accented glyphs
   (è ò à é ç ù û î ï), not the full Latin Extended set. Subsetting typically cuts font
   payload by 70%+. Self-host; never block first paint on a third-party font host.

The reading view is almost entirely static content. Prefer server-rendered HTML with
minimal hydration for article pages; save interactivity for the forum and editor routes.

## Targeted replacements

### 1. i18n: `@solid-primitives/i18n` → Paraglide JS

The current setup in `src/i18n/` is well-built but runtime-based: `getFlatDictionary()`
loads and flattens a whole locale object. Paraglide compiles each message to its own
tree-shakable function. The published benchmark is 47 KB vs 205 KB for 5 locales and
200 messages, and Paraglide's size stays flat as the message count grows.

Migration is mechanical: `locales/fr.ts` and `locales/ht.ts` become `messages/fr.json` and
`messages/ht.json`, and `t('auth.login.title')` becomes an imported `m.auth_login_title()`.
Keep the existing `$lang` routing and `detect.ts` negotiation — Paraglide replaces the
message layer only, not the routing strategy.

Do this **before** adding `en` and `es`, so we never pay the runtime cost at four locales.

### 2. Dependency discipline (do this first, it is an afternoon)

`package.json` currently pins nine TanStack packages to `"latest"` and uses
`nitro: npm:nitro-nightly@latest`. That means the build is not reproducible and a breaking
release can land on us with no warning. On a volunteer team that is a guaranteed lost
weekend.

- Replace every `"latest"` with an exact version.
- Drop `nitro-nightly` for the stable Nitro that the pinned TanStack Start RC expects.
- Commit the lockfile, add Renovate or Dependabot on a weekly schedule, `npm audit` in CI.

### 3. Framework versions: Solid 2.0 RC — DECIDED, reversed

> **Outcome: we adopted Solid 2.0 RC.** The recommendation below was reversed
> after examining the actual migration surface — see `DECISIONS.md` D6 and
> `phases/00-HARDENING.md`. Solid 2.0 removes `Index`, changes `For` child
> signatures, splits `createEffect`, replaces `onMount` with `onSettled`, moves
> `Suspense` to `Loading`, relocates the JSX runtime, and makes context objects
> their own providers. That touches nearly every component, so the cheap window
> is pre-launch, not later. The original reasoning is kept below for the record.

### 3. Framework versions: stay on Solid 1.9 for now

Solid 2.0 reached Release Candidate in August 2026 and TanStack Router, Start and Query
already support it. TanStack Start itself is at v1 RC — feature-complete with a stable API,
with 1.0 to be cut after RC feedback.

Recommendation: **pin the TanStack Start RC now, and stay on Solid 1.9 until Solid 2.0 is
stable.** The reasoning is risk budget, not capability. Solid 2.0's headline features
(first-class async, optimistic mutations, rebuilt reactive core) are real improvements but
they do not change first paint, which is our one hard requirement. Running two RCs at once
on a volunteer team, in an application whose main risk is a data breach, spends our
attention in the wrong place. Write 2.0-friendly code (avoid deprecated primitives, keep
data fetching inside router loaders) and schedule the migration as its own phase after
Solid 2.0 ships stable.

This is a judgement call and reasonable people differ — if we would rather absorb the churn
now while the codebase is 2500 lines than later when it is 15000, that argument is sound
too. It should be a deliberate decision, not a default.

### 4. Editor: TipTap, confirmed

Using ProseMirror directly would be over-engineering — TipTap *is* ProseMirror with a
maintained API and an extension ecosystem. One practical note: there is no first-party
Solid binding. Use the vanilla `Editor` from `@tiptap/core`, construct it in `onMount`,
destroy it in `onCleanup`. Budget a day for the integration; it is not a drop-in component.

**Store article content as ProseMirror JSON, not HTML.** JSON is structured, cannot carry
script, and — critically for the review workflow — can be diffed between revisions so
contradictors can see exactly what changed.

## Roadmap

| Phase | Scope | Why this order |
|---|---|---|
| **0. Hardening** | Pin deps, Paraglide, real transactional email, rate limiting, fix the orphaned-account bug, CI with size budget | Nothing else is safe to build on |
| **1.5. Role rename** | `member`→writer tier, `core_member`→`senior_member`, migration + audit table | Cheap now, expensive after articles exist |
| **2. Articles** | `article` + `article_translation` + visibility, TipTap editor, public reading view | The product |
| **3. Review workflow** | `article_submission` / `article_reviewer` / `article_review` / `article_decision` | See `phases/03-ARTICLES-REVIEW.md` |
| **4. DOCX import** | mammoth pipeline | See `phases/04-DOCUMENT-IMPORT.md` |
| **5. Forum** | Threads on articles; start with polling, add SSE only if needed | Optional for v1 |
| **6. `en` + `es`** | Two locale files, fallback UX | Cheap once Paraglide is in |

Do **not** build WebSockets in phase 5. TanStack Query polling with optimistic updates is
adequate for a forum at KLE's scale; Server-Sent Events over Postgres `LISTEN/NOTIFY` is
the next step if it is not. WebSocket infrastructure is a deployment burden we have not
earned yet.

---

## Outcome

Phase 0 is complete; see `phases/00-HARDENING.md` for the full record.

The headline result is not the framework migration. It is that the client bundle
went from **332.8 KB to 112.9 KB gzipped** once the Better Auth server was
removed from the browser graph — a single mis-scoped import was costing more than
every other optimisation on this page combined.

Two upstream problems were found and worked around, both marked for deletion once
fixed upstream: Better Auth 1.7.4 does not yet support Solid 2 or TanStack Start
2, and its `tanstack-start/solid` integration breaks the Start 2 production build
outright.
