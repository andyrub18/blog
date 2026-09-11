# Architecture

This project will use a simple layered architecture

- Data (PostgreSQL + drizzle orm)
- Business Logic: The interaction with the database, the business logic, error handling etc...
- Auth
- The components: UI components (Solid JS)
- The routes

## Server and client boundary

This is the rule that is easiest to get wrong and most expensive to get wrong.
`src/routes/$lang.tsx` imports `src/lib/session.ts`, which makes that module —
and everything it reaches — client code. A static import of anything server-only
therefore ships to the browser. It once put the entire Better Auth server, with
its kysely, sqlite and postgres adapters, into the client bundle: 136 KB gzipped.

- `src/lib/session.ts` — client-safe. Types, plus the `fetchSessionUser` server function.
- `src/lib/session.server.ts` — server only. Import it dynamically, inside a server boundary.
- `src/lib/auth.ts` — server only, for the same reason.

`createServerOnlyFn` is the escape hatch when server-only code has to live in a
shared module. A build failing with `[import-protection] Import denied in client
environment` means this rule was broken.

## Multilingue structure

Pages and articles exist per language. An article is identified by the composite key `(article_id, lang)`; an author may publish in one language or several, and publication is validated per language. Each user has a preferred language, changeable at any time during a visit, negotiated from a cookie then `Accept-Language`.

UI messages are compiled per locale by Paraglide and called with an explicit `{ locale }` — never a module-level global, because SSR serves concurrent requests in different languages and a shared global would leak one reader's language into another's response.
