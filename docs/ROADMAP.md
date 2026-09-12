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

The number that matters is per page, not the total across every route. Measured
after phase 2, with the closure of static imports each route actually pulls:

| Page | Client JS, gzipped |
|---|---|
| Shared entry (router, Solid, server-function client) | 96.7 KB before phase 2, **99.1 KB** after |
| `/articles` | 101.2 KB |
| `/articles/{slug}` — the reading view | **101.9 KB** |
| `/write/{id}` before the editor loads | 104.7 KB |
| TipTap, fetched only once the editor mounts | +126 KB, in two chunks |

**The budget is currently exceeded by 1.9 KB on the reading view, and the cause
is not the articles.** Phase 2 adds about 5 KB in total: 2.4 KB of route
definitions into the shared entry and 2.8 KB for the reading route itself. The
entry was already 96.7 KB before any of it, of which roughly 74 KB is the
framework floor — the router (30 KB), `@solidjs/web` (27 KB) and the
server-function client (17 KB). Getting back under 100 KB means shrinking that
shared entry, which is phase-0 work and should be taken as its own task rather
than by trimming articles.

What did go right is the thing the budget was most at risk from. TipTap is 126 KB
gzipped and lives in chunks of its own, reached only by the dynamic `import()`
inside `components/editor/ArticleEditor.tsx`. An end-to-end test asserts that an
article page requests no editor script at all, because this is exactly the kind
of regression a refactor introduces silently.

The `/budget` command in `.claude/commands/` reports the total.

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
| **3 · Review** | Submissions, assigned contradictors, qualified-majority decisions | `phases/02-ARTICLES-REVIEW.md` |
| **4 · Import** | DOCX pipeline | `phases/03-DOCUMENT-IMPORT.md` |
| **5 · Forum** | Threads on articles | |
| **6 · `en` + `es`** | Two locale files and the fallback experience | |

Phase 1 comes before articles because the role rename is cheap now and expensive
once articles exist and carry authorship.

## Two standing rules

**Do not build WebSockets in phase 5.** TanStack Query polling with optimistic
updates is adequate at KLE's scale. Server-Sent Events over Postgres
`LISTEN/NOTIFY` is the next step if it is not. WebSocket infrastructure is a
deployment burden we have not earned.

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
