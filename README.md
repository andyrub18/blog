# KLEA

Publishing platform for **KLEA — *Konbit pou Libète ak Egalite an Ayiti***, a Haitian civic
movement. Members propose articles, senior members review them through the
movement's own deliberation process, and readers discuss them in a forum.

The site speaks French, Haitian Creole, English and Spanish, and an article may
be written and published in any of them.

## Running it locally

You need Node 24 and Docker.

```bash
npm install

# A database. The credentials match DATABASE_URL in .env.example.
docker run -d --name klea-db \
  -e POSTGRES_USER=klea -e POSTGRES_PASSWORD=klea -e POSTGRES_DB=klea \
  -p 5432:5432 -v klea-db:/var/lib/postgresql/data postgres:16-alpine

cp .env.example .env.local
# In .env.local, set BETTER_AUTH_SECRET to the output of: openssl rand -base64 32
# Leave the Resend and Turnstile lines commented out — see below.

npm run db:migrate
npm run db:seed         # the super admin, from SUPER_ADMIN_* in .env.local
npm run db:seed:demo    # demo accounts, articles, a debate and a discussion
npm run dev             # http://localhost:3000
```

The next time, `docker start klea-db && npm run dev` is enough.

**Emails print in the terminal running `npm run dev`** — verification links
included — as long as `RESEND_API_KEY` is absent. Copy the link into the browser
to verify an account. Setting the key sends real mail, and a sender on a domain
Resend has not verified makes every send fail. Likewise the Turnstile keys:
absent, the captcha is skipped; a placeholder value is checked against
Cloudflare, fails, and blocks registration. In production the absence of either
is a startup failure, on purpose.

### Trying it

Every demo account's password is `demo-password-123`.

| Account | Role | Try |
|---|---|---|
| `senior@kleayiti.test` | senior member | Review the pending application at `/review`; assign a panel to the waiting proposal at `/review/articles`; invite someone at `/review/invitations` |
| `senior2@`, `senior3@kleayiti.test` | senior members | The other votes a decision or a promotion needs |
| `confirmed@kleayiti.test` | member | Write at `/write`; import a `.docx`; attach a companion PDF to a published article; submit a draft to the circle |
| `reader@kleayiti.test` | reader | Read, and post in an article's discussion |
| `applicant@kleayiti.test` | reader | Has an application waiting for review |
| `newcomer@kleayiti.test` | reader | Can file a membership application at `/apply` |
| `probationer@kleayiti.test` | member | Due for the end-of-probation decision, which a senior member takes at `/review/probation` |

Or register a new reader at `/auth/register/reader` and verify it with the link
from the terminal. Articles are at `/fr/articles` (or `/ht`, `/en`, `/es`);
*Réforme de l'administration publique* shows the contents list, and
*L'éducation comme priorité vérifiable* the fallback banner in any language
but French.

`npm run db:seed:demo` puts everything back as it was — run it again whenever
you have approved, published or deleted your way out of something to try.

For a LaTeX document: `pandoc chapter.tex -o chapter.docx`, then import the
`.docx` into an article. Attach the PDF `pdflatex` made as its companion.

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
