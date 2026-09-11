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
JS for an article page. Measure before and after any dependency addition:

```bash
npm run build
find .output/public/assets -name '*.js' | while read f; do gzip -c "$f" | wc -c; done \
  | awk '{s+=$1} END {printf "client JS gzipped: %.1f KB\n", s/1024}'
```

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
  are skipped unless `E2E_DATABASE` is set.

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

## Style

Biome, single quotes, no semicolons, 2-space indent. Comments explain *why*, not
what — especially for anything that looks like it could be simplified but
cannot. Write user-facing strings as messages, never inline literals.
