# Phase 0 — Hardening

_Completed September 2026. Branch: `phase-0-hardening`._

Foundation work, done before any feature work, so nothing is built on sand.

## What was done

**Dependencies pinned.** Nine TanStack packages were on `"latest"` and Nitro on a
nightly build. All now pinned exactly (see D8). `npm audit` reports no
high-severity advisories; four moderate ones come from `drizzle-kit`'s dev-only
`esbuild-kit` dependency.

**Migrated to Solid 2.0 RC** (D6), with the coordinated set: `solid-js` and
`@solidjs/web` at `2.0.0-rc.8`, `@tanstack/solid-start` and `solid-router` at
`2.0.0-rc.7`, `@tanstack/solid-query` at `6.0.0-rc.3`, `vite-plugin-solid` at
`3.0.0-next.27`. Code changes: `onMount` → `onSettled`, `Suspense` → `Loading`,
`solid-js/web` → `@solidjs/web`, `jsxImportSource` → `@solidjs/web`, and
`<Context.Provider>` → `<Context>`.

**Migrated i18n to Paraglide.** `@solid-primitives/i18n` loaded and flattened a
whole dictionary at runtime; Paraglide compiles each message to its own
tree-shakable function. 74 messages per locale moved from `src/i18n/locales/*.ts`
to `messages/*.json`.

The first pass threaded the locale by hand — `m.key({}, { locale: locale() })` at
98 call sites — on the reasoning that a global locale would leak between
concurrent SSR requests. That reasoning was over-cautious: Paraglide solves
exactly that with `paraglideMiddleware` and AsyncLocalStorage, and the setup was
also left on the default `cookie`/`globalVariable` strategy, which never consulted
the URL that actually determines the language on this site.

Corrected: the strategy is now `url` first, the middleware is registered in
`src/start.ts` via `createStart({ requestMiddleware })`, and all 98 call sites
collapsed to `m.key()`. The middleware passes the original request through, since
TanStack Router owns URL localization under `/$lang`. Paraglide's cookie is named
`lang` to match `src/i18n/detect.ts`, so the two cannot disagree.

**Dropped `@tanstack/solid-form`.** Only an alpha supports Solid 2, and the three
forms were inconsistent — one already used plain signals. All three now use plain
signals against one shared validation module, which removed an alpha dependency
and made the forms directly testable.

**Session moved server-side.** `authClient.useSession()` fetched the session from
the browser, so the first paint rendered signed-out. The session now loads in the
`/$lang` route's `beforeLoad` and arrives in the SSR payload. This also removed
the dependency on `better-auth/solid`'s Solid 1 reactivity.

## Bugs fixed

**Orphaned accounts on failed member signup.** `signUpMember` created the user
and *then* saved the PDFs. A failed upload left an account with no application,
which could never be completed and — because of the `UNIQUE` constraint on
`member_application.userId` — could never be re-applied for. Files are now
validated and staged in memory before the account is created, with a compensating
delete if the application insert fails afterwards.

**Uploads trusted `file.type`.** That value is set by the client. A ZIP renamed
to `.pdf` and labelled `application/pdf` passed validation. Now checked by magic
bytes (`%PDF-`). The filename sanitiser was also hardened to collapse `..`.

**`isAdult()` tested `>= 13`.** Renamed to `meetsMinimumAge` against an explicit
`MIN_ACCOUNT_AGE_YEARS`, since 13 is a safeguarding floor, not majority.

**Age was computed in the wrong timezone** — found by the new tests. The function
parsed a date-of-birth string (UTC midnight) and read it back with local getters,
which shifts it a day in any timezone behind UTC, Haiti included, and silently
changed the computed age around a birthday. Now compared entirely in UTC.

## The find that mattered most

The client bundle was **332.8 KB gzipped**. A single 136 KB chunk turned out to
be the entire Better Auth *server* — kysely, sqlite and postgres adapters — in
the browser.

Cause: `routes/$lang.tsx` imports `lib/session.ts`, so `session.ts` is client
code. Its non-server-function exports (`getSession`, `requireUser`, …) carried a
dynamic `import('./auth')`, which pulled the auth server into the client graph.

Fix: split `session.ts` (client-safe types plus the `fetchSessionUser` server
function) from `session.server.ts` (everything touching Better Auth).

**Result: 332.8 KB → 112.9 KB gzipped**, with no loss of functionality. This is
the single highest-value change in the phase, and the reason the rule about
server-only imports is called out in `CLAUDE.md`.

## Upstream problems worked around

**Better Auth does not support Solid 2 or TanStack Start 2 yet** (current release
1.7.4). Two consequences:

1. It declares optional peers on `solid-js@^1` and `@tanstack/solid-start@^1`.
   `.npmrc` sets `legacy-peer-deps=true` with the reasoning written in the file.
   Safe here only because every version is pinned exactly.
2. `better-auth/tanstack-start/solid` **breaks the production build** outright:

   ```
   Missing "#tanstack-start-server-fn-resolver" specifier in "@tanstack/solid-start"
   ```

   It reaches for `@tanstack/solid-start/server` through a dynamic import, which
   under Start 2 pulls the server-function handler into an environment where that
   virtual module is not registered. Reimplemented locally in
   `src/lib/auth-cookies.ts`, wrapped in `createServerOnlyFn`.

Both workarounds are marked for deletion once Better Auth ships support. They are
the concrete cost of running two release candidates — worth recording, since D6
accepted that cost deliberately.

## Testing

Vitest for unit, integration and component tests; Playwright for e2e across
desktop and mobile viewports. **50 tests passing**, typecheck clean, build green.

The i18n test is the one to keep: it fails if any message key is missing,
orphaned, blank, or has mismatched placeholders in any locale — the failure mode
where a Creole reader is silently served French.

## Not done in this phase

- Real transactional email. **This is the top P0 in `../SECURITY.md`** and must
  land before any real user registers; verification is currently a console log.
- Rate limiting, CAPTCHA on registration.
- The role rename to `senior_member` (D2) — phase 1.5, needs a migration.
- Raising the password minimum and essay minimum, and moving to birth year — all
  touch the schema and belong with the enrollment work.
- `en` and `es` locales — phase 6. The registry and tests are ready for them.
