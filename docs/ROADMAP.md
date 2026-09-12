# Roadmap

Why decisions were made is in `DECISIONS.md`. What each phase contains is in
`phases/`. This file is the order and the one constraint that governs all of it.

## The constraint: first-load weight

Readers arrive on slow, metered Haitian mobile data. Someone hears about KLE,
opens the site, and waits — that is the failure this project cannot afford.

**Budget: under 100 KB gzipped of client JavaScript for an article page.**

```bash
npm run build
find .output/public/assets -name '*.js' | while read f; do gzip -c "$f" | wc -c; done \
  | awk '{s+=$1} END {printf "client JS gzipped: %.1f KB\n", s/1024}'
```

The number that matters is per page, not the total across every route. Measure
it with `npm run build && npm run budget`, which walks Vite's manifest and sums
the static import closure of the entry plus one route — the chunks a browser
must have before that page is interactive.

| Page | Client JS, gzipped |
|---|---|
| Shared entry, on every page | **95.3 KB** |
| `/articles/{slug}` — the reading view | **98.7 KB** |
| `/articles` | 97.4 KB |
| `/` — the home page | 98.0 KB |
| `/articles/{slug}/discussion` — the forum | 102.6 KB (opened from an article) |
| `/write/{id}` — the editor, before TipTap loads | 108.6 KB (author screen) |
| TipTap itself, fetched only when the editor mounts | +126 KB, in two chunks |

**The budget is met, with 1.3 KB of headroom.** It was not, for three phases:
the reading view peaked at 103.8 KB after phase 3. Two things fixed it.

**TanStack Query was in every page and nothing used it.** The scaffold put a
`QueryClient` in the router context and it had been shipping to every reader
ever since — 6.6 KB gzipped for a library with no call sites. Removed, along
with the dependency (D17). Phase 5 was expected to bring it back for forum
polling, scoped to the forum route; it did not, and D20 records why — the loop
the forum actually needs is forty lines of `setTimeout`, and it is not the loop
Query's defaults would have given it.

**Preloading was fetching everything twice.** `defaultPreloadStaleTime` was `0`
with `defaultPreload: 'intent'`, so hovering a link ran the route's loader,
the result was stale the instant it arrived, and clicking through fetched the
same thing again. Not bundle bytes, but the same bill: server-function responses
paid for twice by a reader paying per megabyte. Now 30 seconds, so the fetch a
tap starts is the one the navigation uses.

Roughly **81 KB of what remains is the framework floor** — the router (23 KB),
`@solidjs/web` (26 KB), the server-function client (17 KB) and Paraglide's
runtime (9 KB). Shrinking that means giving something up rather than tuning
something, and D7 already weighed the largest piece of it.

**The trend to watch:** every route's non-component module sits in the entry
graph, so the entry grows with the number of routes whether or not anybody
visits them — about 0.5 KB each. Phase 5's single new route cost the entry
0.8 KB, paid by every reader including the ones who never open a discussion.
Splitting loaders out of the entry was tried and reverted: it moved 0.3 KB out
of the entry and added 0.3 KB back to the page, plus a round trip on navigation.

**And watch the measurement itself.** Phase 5 found that `npm run budget`
matched route files by prefix, so `articles/$slug` also matched
`articles/$slug_/discussion`: it reported the reading view at 105.3 KB and over
budget when it was at 99.1 KB and under. A gauge that is wrong in the alarming
direction gets believed, and then something gets cut for nothing.

Run `/budget` or `npm run budget` after any dependency change.

Four things decide whether the budget holds:

1. **Compile-time i18n.** Paraglide tree-shakes per message, so bundle size does
   not grow with locales or message count.
2. **The editor must never reach readers.** Done in phase 2: TipTap is 126 KB
   gzipped and is reached only by a dynamic `import()` inside the editor's own
   effect, so it is fetched when somebody starts writing and at no other time.
   An end-to-end test fails if an article page ever requests it.
3. **Images, not JavaScript, are usually the bill.** AVIF/WebP, responsive
   `srcset`, explicit dimensions, lazy-load below the fold.
4. **Subset the fonts** to Latin plus the accented glyphs Creole and French
   actually use — è ò à é ç ù û î ï — not the full Latin Extended range.

The reading view is almost entirely static. Prefer server-rendered HTML with
minimal hydration there, and spend interactivity on the forum and the editor.

## Order

| Phase | Scope | Status |
|---|---|---|
| **0 · Hardening** | Pinned dependencies, Solid 2, Paraglide, tests, transactional email | **Done** — `phases/00-HARDENING.md` |
| **1 · Enrollment** | Role rename, applications, probation, promotion, cooptation, blocking, audit log | **Done** — `phases/01-ENROLLMENT.md` |
| **2 · Articles** | `article` + `article_translation` + visibility, TipTap editor, reading view | **Done** — `phases/02-ARTICLES-REVIEW.md` |
| **3 · Review** | Submissions, assigned contradictors, qualified-majority decisions | **Done** — `phases/02-ARTICLES-REVIEW.md` |
| **4 · Import** | DOCX pipeline | **Done** — `phases/03-DOCUMENT-IMPORT.md` |
| **5 · Forum** | Threads on articles, moderated after the fact | **Done** — `phases/04-FORUM.md` |
| **6 · `en` + `es`** | Two locale files and the fallback experience | |

Phase 1 comes before articles because the role rename is cheap now and expensive
once articles exist and carry authorship.

## Two standing rules

**Do not build WebSockets in phase 5.** Kept: the forum polls. Server-Sent
Events over Postgres `LISTEN/NOTIFY` is the next step if that stops being
enough. WebSocket infrastructure is a deployment burden we have not earned. (The
polling is hand-written rather than TanStack Query's — D20.)

**Security is not a phase.** It is a property of every phase. The threat model
and the prioritised controls live in `SECURITY.md`; read it before touching
auth, uploads, or anything that reads a dossier.

## Remaining P0s before real users

From `SECURITY.md`, in order:

1. **A verified sending domain in Resend**, with SPF, DKIM and DMARC. Until then
   the account is sandboxed and can only mail its own owner, so nobody else can
   complete registration.
2. **Turnstile keys** in the deployment environment. The code refuses to start
   without them in production, which is the intent, but it does mean the deploy
   fails until they are set.
3. **Retire the mock Google sign-in path.**

None of these blocks development. In development the mailer prints to the console
and the captcha is skipped; `ALLOW_INSECURE_LOCAL=true` covers a local production
build too. They block *deploying*, which is the right place for them to bite.

Rate limiting and bot defence landed with the enrollment groundwork — see
`SECURITY.md` P0 items 2 and 3.
