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

Current total across every route: ~119 KB. A single page loads a fraction of it.
The `/budget` command in `.claude/commands/` reports this.

Four things decide whether the budget holds:

1. **Compile-time i18n.** Paraglide tree-shakes per message, so bundle size does
   not grow with locales or message count.
2. **The editor must never reach readers.** TipTap is 100–200 KB. Route-split it
   so only the writing and review routes load it. This is the largest single win
   still available.
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
| **1 · Enrollment** | Role rename, applications, probation, promotion, audit log | Next — `phases/01-ENROLLMENT.md` |
| **2 · Articles** | `article` + `article_translation` + visibility, TipTap editor, reading view | |
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

1. Rate limiting on the auth endpoints, and a CAPTCHA on registration.
2. A verified sending domain in Resend, with SPF, DKIM and DMARC — until then
   the account is sandboxed and can only mail its own owner.
3. Retire the mock Google sign-in path.
