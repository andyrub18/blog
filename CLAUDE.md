# KLE platform — working notes

Publishing platform for **KLE — Konbit libète ak egalite**, a Haitian civic
movement. Members propose articles, senior members review them through the
movement's own deliberation process, and readers discuss them in a forum.

The governing document is the KLE manifesto. Where this codebase encodes a rule
about membership, deliberation or publication, that rule comes from the
manifesto and should not be "simplified" without a decision from KLE.

## Two things that override normal judgement

**1. This data is dangerous if it leaks.** We hold names, emails, CVs with
employers and addresses, and political essays from engaged Haitians. The
manifesto names armed non-state actors among the movement's adversaries. A
leaked roster is a targeting list. When confidentiality trades against
convenience or availability, confidentiality wins. Read `docs/SECURITY.md`
before touching auth, uploads, or anything that reads a dossier.

**2. First-load weight is a feature, not a nicety.** Readers arrive on slow,
metered Haitian mobile data. The budget is **under 100 KB gzipped** of client
JS for an article page, and it currently has about 2.7 KB of headroom. Measure
before and after any dependency addition:

```bash
npm run build && npm run budget
```

That reports the static import closure per page, which is what the budget means.
Totalling every file in `.output/public/assets` measures the whole site
including the editor — a number no reader ever pays, and one that read 280 KB
while an article page was 103 KB.

A dependency ships when a feature needs it, not when a template suggests it
(D17). An unused `QueryClient` sat in the router context for three phases and
cost every reader 6.6 KB.

## Commands

```bash
npm run dev            # dev server on :3000
npm run build          # production build
npm run typecheck      # tsc --noEmit
npm test               # vitest: unit + component + Postgres suite
npm run test:db        # only the Postgres integration tests (needs Docker)
npm run test:coverage  # with coverage
npm run test:e2e       # playwright (starts its own dev server)
npm run check          # biome lint + format check
npm run db:generate    # drizzle migration from schema changes
npm run db:migrate     # apply migrations
npm run db:seed        # create the super admin
npm run db:seed:demo   # demo accounts + a pending application (dev only)
```

## Architecture

Layered, in dependency order: **data** (PostgreSQL + Drizzle) → **business
logic** (server functions) → **auth** (Better Auth) → **components** (Solid) →
**routes** (TanStack Start, file-based under `src/routes`).

- `src/lib/db/schema/` — Drizzle schema. Change here, then `db:generate`.
- `src/lib/validation.ts` — pure validation rules, shared by client forms and
  server actions so both enforce the same thing. No IO, no framework. Test it.
- `src/lib/auth.ts` — Better Auth config. **Server only.**
- `src/lib/session.ts` — client-safe: types plus the `fetchSessionUser` server
  function.
- `src/lib/session.server.ts` — server only: `getSession`, `requireUser`,
  `requireRole`, `redirectIfAuthenticated`.
- `src/lib/prosemirror.ts` — the article document format: the node/mark
  allowlist, the parser and the server-side HTML renderer. Pure, no IO. Test it.
- `src/lib/articles.ts` — article business logic. `src/lib/article-actions.ts` —
  the server functions, each re-checking the caller.
- `src/lib/docx.ts` — the DOCX import pipeline. **Server only.**
  `src/lib/html-to-prosemirror.ts` — HTML to our format, and the thing that makes
  an imported file safe.
- `src/lib/deliberation.ts` — the review rules: quorum, the per-language
  threshold, the five documentation fields. Pure, and therefore safe for a route
  to import. `src/lib/article-review.ts` is the flow around them, and is
  **server only** — it reaches `node:crypto` and the database.
- `src/i18n/` — locale registry and the locale context.
- `messages/<locale>.json` — translations, compiled by Paraglide.

## Rules that are easy to get wrong

**Never statically import server-only modules from anything a route reaches.**
`src/routes/_app.tsx` imports `lib/session.ts`, so everything reachable from
there ends up in the browser graph. A static `import { auth }` once put the
entire Better Auth server — kysely, sqlite and postgres adapters — into the
client bundle: **136 KB gzipped of pure waste**. Import server modules
dynamically inside a server boundary:

```ts
const { requireRole } = await import('../lib/session.server')
```

If the build fails with `[import-protection] Import denied in client
environment`, this is what happened. `createServerOnlyFn` is the escape hatch
when the code must live in a shared module.

**Reading a dossier is logged, always.** `lib/dossier.ts` writes an
`access_event` for every file read, and `fetchApplication` logs opening an
application. These are CVs and political essays belonging to people organising in
Haiti; the only honest basis for telling a member their file is not circulating
is being able to say who opened it and when. Never add a read path that skips
the log. Dossiers are also served as attachments, never inline — a PDF rendered
in the browser can carry active content.

**Authorise inside every server function, not only in route guards.** A route
guard is UX. A `createServerFn` is a public HTTP endpoint and must re-check the
caller's role itself, every time.

**Never trust `file.type` on an upload.** It is set by the client. Check magic
bytes — `stageApplicationPdf` in `src/lib/uploads.ts` is the reference.

**Validate and stage uploads before creating an account.** Creating the user
first means a failed upload strands an account with no application. See the
comment in `signUpMember`.

**Article content is parsed before it is stored, and again before it is
rendered.** `parseDocument` in `src/lib/prosemirror.ts` drops every node, mark
and attribute outside its allowlist. Never store what the editor sent; never add
a node type without asking what it lets an author put in another reader's
browser. There is no image node and no raw-HTML node, both on purpose.

**The reading view renders on the server and ships no JavaScript of its own.**
`fetchArticle` returns HTML and deliberately strips the ProseMirror document
from the payload — sending both would put the same article on the wire twice, on
the one page the budget exists for. `innerHTML` on that string is safe *because*
the renderer wrote every tag and escaped every author-supplied character; it
would not be safe for HTML from anywhere else.

**Never import `@tiptap/*` anywhere but inside the editor's effect.** It is
126 KB gzipped. `components/editor/ArticleEditor.tsx` loads it with a dynamic
`import()` and imports only its *type* statically; `e2e/articles.spec.ts` fails
if an article page ever requests an editor script. Splitting the component
instead — `lazy()` on the route — does not work: the server renders the toolbar,
the client manifest has no entry for the module, and hydration gives up, leaving
a toolbar that looks right above an editor that never appears. Keep the editor's
extension set matched to the server allowlist, or a toolbar button silently
loses an author's formatting on save.

**Do not bind `value` on a `<textarea>`.** Solid's SSR writes the value as a
child text node while the client template has none, so the two sides end up one
node apart and hydration silently detaches everything after it — the page looks
right and stops answering clicks. Leave the textarea uncontrolled and read it in
`onInput`; put an initial value in as a JSX child. `<input value={…}>` is fine.
Every textarea in the codebase now follows this; `review/invitations.tsx` shows
the shape to use when the field also has to be cleared programmatically.

**Publication is a decision, not a button.** A language goes live because
`decide()` in `article-review.ts` accepted it, per language (D12). There is no
publish endpoint; `withdrawTranslation` only takes one down. If you find
yourself adding a way for one person to publish, you are building the thing this
platform exists to make unavoidable (D13, D15).

**An imported document is rebuilt, never cleaned.** Mammoth sanitises nothing
(it says so itself), so `html-to-prosemirror.ts` is what stands between a Word
file somebody emailed an author and a public page. It copies no tag through:
every node comes from the allowlist in `prosemirror.ts`. Do not add a shortcut
that passes HTML along, and do not add a tag to its tables without asking what
it lets a document put in a reader's browser (D18).

**Check a `.docx` before opening it, in this order:** `file.size` before the
body is read, then `PK\x03\x04` (the MIME type is the client's), then the ZIP
central directory — entry count, total uncompressed size, per-entry compression
ratio — and only then `[Content_Types].xml` and a `word/` entry. Finding out how
big an archive expands to by expanding it is the bug that whole step exists to
avoid.

**Import the review rules from `deliberation.ts`, never from
`article-review.ts`.** A route that imports a *value* from the latter pulls
`node:crypto` and the database into the browser: the page renders, hydration
throws, and nothing on it responds. Types are fine either way — they compile
away.

**Dates of birth are compared in UTC.** An `<input type="date">` value parses as
UTC midnight; reading it with local getters shifts it a day in any timezone
behind UTC, Haiti included, and silently changes a computed age.

## i18n

Paraglide compiles each message into its own tree-shakable function, so bundle
size does not grow with the number of locales. Call a message with no arguments:

```tsx
import { m } from '../paraglide/messages'

m.auth_login_title()
```

The locale is ambient, not passed. `src/server.ts` wraps the whole handler in
`paraglideMiddleware`, so every request runs inside an AsyncLocalStorage scope and
`getLocale()` resolves per request — SSR serves concurrent requests in different
languages, and that isolation is what keeps them from leaking into each other. On
the client the locale comes from the URL.

Configuration lives in `src/i18n/paraglide-options.ts`, shared by `vite.config.ts`
and `vitest.config.ts`. Two things there are deliberate: the strategy is
**`url` first**, so a link to `/ht/atik` renders Creole even if the reader's
cookie says French; and both locales carry a prefix, so neither language is the
unnamed default.

**There is no `$lang` route parameter.** Routes are written once at their plain
path (`/auth/login`) and the router translates, via `rewrite` in
`src/router.tsx`: `input` strips the prefix before matching, `output` puts it
back when generating links. Every `<Link>` is localized automatically and no
component threads a language through.

`src/server.ts` forwards the **original** request, not the de-localized one
Paraglide offers, because the router already de-localizes — letting both rewrite
would strip the prefix twice.

Message keys are the old dotted paths with underscores: `auth.login.title`
becomes `auth_login_title`. For a message chosen at runtime (an error code, say),
map the code to the **message function**, not to a key string — a dynamic key
lookup defeats tree-shaking. `ERROR_MESSAGE` in `LoginForm.tsx` shows the shape.

Adding a locale: add the code to `LOCALES` and `LOCALE_LABELS` in
`src/i18n/index.ts`, add `messages/<code>.json`, add it to
`project.inlang/settings.json`, and add a `urlPatterns` entry in
`src/i18n/paraglide-options.ts` so it gets a path prefix. `src/i18n/messages.test.ts` fails if any key is
missing, orphaned, blank, or has mismatched placeholders.

## Testing

Three layers — three Vitest projects plus Playwright:

- **unit** — `src/**/*.test.ts[x]`, jsdom. Pure logic and components.
- **db** — `src/**/*.db.test.ts`, node, real PostgreSQL in Docker via
  Testcontainers. `src/test/postgres.ts` starts a throwaway container and applies
  the committed migrations, so a migration that does not apply cleanly fails here
  rather than on deploy. Needs a running Docker daemon.
- **e2e** — `e2e/`, Playwright, desktop and mobile. Specs needing real accounts
  are skipped unless `E2E_DATABASE` is set. To run those:

  ```bash
  npm run db:migrate && npm run db:seed:demo   # against the target database
  npm run dev
  E2E_DATABASE=1 npx playwright test
  ```

  Every e2e test owns its own seeded account. The flow is stateful — an approved
  application leaves the queue, and a reader with an open application no longer
  sees the form — so sharing an account between tests makes them pass or fail on
  the order they happened to run in. `db:seed:demo` resets that state on every
  run rather than skipping what already exists, so one run does not leave the
  next with an empty queue. It also clears `auth_throttle`, because repeated
  sign-ins trip the per-IP limit and one run would lock out the next.

  **Call `waitForInteractive(page)` before the first click on a page.**
  Server-rendered markup is visible and clickable before the bundle runs, and a
  click sent in that window is silently lost — in dev the route's client module
  may still be compiling, which is when this bites. The layout in
  `src/routes/_app.tsx` sets `data-hydrated` on `<html>` once the client takes
  over, and the helper waits for it. Without it the suite passes on a warm
  server and fails on a cold one.

Anything whose correctness lives in SQL belongs in the db project. The rate
limiter is the example: its behaviour is an `INSERT … ON CONFLICT DO UPDATE` with
a `CASE`, and a mock would simply agree with whatever it did. The real container
caught a `Date` serialisation bug that made every call throw — no unit test could
have found it.

Note `extends: true` on each project in `vitest.config.ts`. Without it a project
does not inherit `resolve.conditions`, Solid resolves its server build, and every
component render fails with "Client-only API called on the server side".

Test the rule, not the implementation. The upload tests assert that a ZIP
labelled `application/pdf` is rejected; that is the actual security property.

## Email

Transactional mail goes through `src/lib/email/`. Templates are pure functions
returning `{ subject, html, text }`; the transport is chosen once from the
environment. Locale comes from the request scope, so people get mail in the
language they were using.

Three rules:

- **Escape anything user-supplied** before putting it in the HTML body. Display
  names come from public registration.
- **Never log the message body or a verification URL.** That link grants account
  access and logs are read by more people than the inbox.
- **Keep the copy in `messages/*.json`**, not inline, so the i18n parity test
  catches a missing translation.

Locally, leaving `RESEND_API_KEY` unset prints mail to the console. In production
a missing key is a startup failure, on purpose. To run a *production build*
locally without Cloudflare or Resend credentials, set `ALLOW_INSECURE_LOCAL=true`
— it lifts both guards and warns loudly. Never set it on a deployed server.

## Rate limiting and captcha

**The important thing to know:** Better Auth's rate limiter and captcha plugin
hook `onRequest`, so they only protect traffic that reaches `/api/auth/*`.
Sign-in and sign-up go through server functions that call `auth.api.*`
in-process and never touch that path. Their protection lives in `guard()` in
`auth-actions.ts`, and any new auth-adjacent server function needs to call it
too — nothing else will.

Counters are in Postgres (`auth_throttle`), not memory: an in-memory counter
resets on deploy and is per-instance, so an attacker gets a fresh budget from
each. `rate_limit` is a separate table owned by Better Auth; its shape is
dictated by the library, so do not tidy it.

Captcha applies to **reader registration only**. The member application asks for
three PDFs, two essays and a human review — that friction filters automated abuse
better than a challenge, and adding one would tax the most committed applicants
for nothing. Volume abuse there is rate-limited instead.

Captcha verification **fails closed**. If Cloudflare is unreachable, registration
is blocked rather than waved through. Locally, leaving `TURNSTILE_SECRET_KEY`
unset disables the check entirely; in production its absence is a startup
failure, same as the mailer.

## Dependency policy

**Every dependency is pinned to an exact version — no `^`, no `~`, no
`latest`.** We run TanStack Start 2 RC and Solid 2 RC deliberately (see
`docs/DECISIONS.md`), and on release candidates a floating range means a
breaking change lands unannounced. Upgrade deliberately, as its own commit.

`.npmrc` sets `legacy-peer-deps=true` for one specific reason, documented in the
file: Better Auth 1.7.4 declares optional peers on Solid 1 and Start 1. We do
not use its Solid integration. Delete that file when Better Auth ships Solid 2
support.

`src/lib/auth-cookies.ts` is a local reimplementation of
`better-auth/tanstack-start/solid`, which breaks the Start 2 build. Delete it and
go back upstream when that is fixed.

**Solid 2 has no `onMount`.** It type-checks — the installed types still declare
it — and then fails at runtime with `onMount is not a function`, taking the whole
route render with it. Use an effect whose compute is constant so its apply step
runs once on the client:

```ts
createEffect(
  () => undefined,
  () => {
    /* client-only work */
  },
)
```

Anything placed in `__root.tsx`'s `shellComponent` will not run on the client at
all: the shell is server-rendered only.

## Style

Biome, single quotes, no semicolons, 2-space indent. Comments explain *why*, not
what — especially for anything that looks like it could be simplified but
cannot. Write user-facing strings as messages, never inline literals.
