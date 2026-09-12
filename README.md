# KLE

Publishing platform for **KLE — *Konbit libète ak egalite***, a Haitian civic
movement. Members propose articles, senior members review them through the
movement's own deliberation process, and readers discuss them in a forum.

The site is bilingual French and Haitian Creole today, with English and Spanish
planned for the diaspora.

## Running it

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run db:migrate
npm run db:seed                # creates the super admin
npm run dev                    # http://localhost:3000
```

Without `RESEND_API_KEY` and `EMAIL_FROM`, verification emails are printed to
the console instead of sent. That is intentional for local work; in production
their absence is a startup failure.

## Commands

| | |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest — unit, integration, component |
| `npm run test:e2e` | Playwright, desktop and mobile |
| `npm run check` | Biome lint and format |
| `npm run db:generate` | Drizzle migration from schema changes |
| `npm run email:test -- <to> [locale]` | Send a real verification email |

## Stack

TypeScript, **Solid 2** and **TanStack Start** (both on pinned release
candidates), **Drizzle** with **PostgreSQL**, **Better Auth**, **Paraglide** for
compile-time i18n, **Resend** for transactional mail, Tailwind for styling.

Every dependency is pinned to an exact version. See `docs/DECISIONS.md` for why.

## Documentation

Start with **`CLAUDE.md`** — it is the working guide, and the rules there about
the server/client boundary and upload validation are the ones most likely to
bite.

| | |
|---|---|
| `docs/OVERVIEW.md` | What the product is |
| `docs/ARCHITECTURE.md` | Layers, and the server/client boundary |
| `docs/DECISIONS.md` | Settled decisions and their reasoning |
| `docs/ROADMAP.md` | Phase order and the first-load budget |
| `docs/SECURITY.md` | Threat model and prioritised controls |
| `docs/phases/` | Specification per phase |

## Two things to know before contributing

**This data is dangerous if it leaks.** The platform holds names, emails, CVs
and political essays from engaged Haitians. Read `docs/SECURITY.md` before
touching auth, uploads, or anything that reads an application dossier.

**First-load weight is a feature.** An article page must stay under 100 KB
gzipped of client JavaScript. Measure before and after adding a dependency;
`docs/ROADMAP.md` has the command.
