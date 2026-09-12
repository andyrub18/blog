# Decisions

Settled decisions, with the reasoning that produced them. Revisit only with a
reason; do not silently re-litigate.

_Last updated: September 2026._

## D1 — Article visibility defaults to public

New articles are `public`; `members` is the deliberate exception. A movement
whose purpose is national influence should not hide its output behind a signup
wall. Public articles are the ones search engines index, so this column is
effectively KLE's reach policy.

## D2 — The app uses the manifesto's role vocabulary

`reader` (Lektè) → `member` (Manm) → `senior_member` (Manm senyò) →
`super_admin`. This renames the draft's `core_member` to `senior_member` and
keeps `member` as the writer tier. The app's roles are the movement's roles, in
all four languages, so nobody carries a translation table in their head.

## D3 — Members may publish under a pseudonym

The admission committee needs a legal name; the byline does not. In Haiti that
distinction can matter a great deal. Implementation: `display_name` separate from
`legal_name`; the audit log always records the legal name; the pseudonym is not
freely self-editable — changes go through a senior member, or a byline someone
can change at will defeats accountability.

## D4 — Senior-member promotion takes a qualified majority

At least three approvals and at least two-thirds of those voting, recorded
individually. The people being promoted gain access to every member's dossier,
which is exactly the kind of consequential decision the manifesto refuses to
settle by simple majority.

## D5 — Hosted abroad, in US East

The application, database and object storage run on a managed provider in **US
East (Virginia) or Miami**. Latency from Haiti to US East is roughly 30–60 ms
against 120–180 ms to Europe, and first-load speed is the project's hard
requirement. Document storage stays in the same region to avoid cross-region
latency and egress.

The trade-off, recorded deliberately: member data then sits under US legal
process. For a Haitian political movement this is very likely safer than hosting
in-country, but we are asking members to trust us with their CVs, so the
reasoning belongs in writing.

## D6 — Solid 2.0 RC now, not after stable

**Reversed from the earlier recommendation.** The initial advice was to stay on
Solid 1.9 and migrate later, reasoning from risk budget. That was wrong once the
actual migration surface was examined: Solid 2.0 removes `Index`, changes `For`
child signatures, splits `createEffect` into compute and apply phases, replaces
`onMount` with `onSettled`, moves `Suspense` to `Loading`, moves the JSX runtime
to `@solidjs/web`, and makes context objects their own providers. That touches
essentially every component.

Migrating at 2,500 lines is a day. Migrating at 15,000 lines is weeks. The window
where this is cheap is now, pre-launch, with no users.

Conditions: pin the coordinated RC set together, and treat RC bumps as scheduled
work rather than something done mid-feature.

## D7 — Stay on Solid; do not pivot to React

Considered and rejected. A React pivot does not buy RC safety — TanStack Start is
at v1 RC for React too. It costs the perf budget: `react` + `react-dom` is around
45 KB gzipped against Solid's ~7 KB, which is a large share of a 100 KB budget
before a line of application code. The contributor argument is real but weaker
than it looks: Solid is JSX with the same component model, and a competent React
developer is productive in it inside a week.

**What would flip this:** handing the project to a group of volunteer
contributors within a couple of months. When labour is the bottleneck,
availability of hands beats runtime efficiency.

## D8 — Every dependency pinned exactly

No `^`, no `~`, no `latest`. On release candidates a floating range means a
breaking change arrives unannounced, which on a volunteer team is a lost weekend.

## D9 — TipTap, not ProseMirror directly

TipTap *is* ProseMirror with a maintained API; using ProseMirror directly would
be over-engineering. There is no first-party Solid binding, so the vanilla
`Editor` is constructed once on the client and destroyed in `onCleanup`.

Two corrections from building it. Solid 2 has neither `onMount` nor `onSettled`,
so the construction happens in an effect whose compute is constant — the same
shape `routes/_app.tsx` uses. And the editor's extension set is configured to
match the server's allowlist exactly (`underline` is switched off, links are
checked with the same `isSafeHref`), because a button that produces something the
server drops loses an author's formatting on save and tells them nothing.

## D10 — Article content is stored as ProseMirror JSON

Not HTML. JSON diffs cleanly between revisions, which the adversarial review
stage needs, and it cannot carry script.

## D11 — Documents go to managed object storage

Private buckets, random UUID keys, short-lived signed URLs, encryption at rest,
same region as the app. Never the local filesystem in production — it does not
survive a redeploy, and it is the wrong security posture for dossiers.

## D12 — Publication is per language, on the translation

`article.status` is the life of the work; `article_translation.status` and
`published_at` are the life of one language of it, and the reading view checks
the translation. A single article-level flag cannot express the normal case for
this movement — the French is ready, the Creole is still being written — and
would put an unfinished draft in front of readers the moment another language
was approved.

Withdrawing one language is therefore not a retraction of the article. It leaves
`article` and the other translations alone, because conflating an editorial
correction with a retraction would make the audit trail lie about what happened.

## D13 — An author does not publish their own article

`publishTranslation` requires a senior member. The manifesto does not let an
author decide that their own proposal has been accepted, and phase 3's
submission workflow will put a documented proposal and assigned contradictors
behind that judgement.

Recorded as a decision rather than a placeholder because the constraint had to
exist from the first article, not from the day the workflow lands. A
self-publish button is the hardest kind of thing to take away: by the time the
review process arrived, people would have been publishing that way for months
and the removal would read as a loss of trust rather than the rule working.
Phase 3 replaces the judgement behind the constraint, not the constraint.

## D14 — Article HTML is rendered on the server

`renderDocumentToHtml` runs in the server function; the reading view receives
finished markup and the stored ProseMirror document never crosses the wire.
Sending both would mean every reader downloads the same article twice, on the
one page the 100 KB budget is written for, and would put a renderer in the
client bundle to rebuild markup the server already had.

The document is parsed against the allowlist on the way in *and* again on the
way out. The row was sanitised when it was written, but the rules can tighten and
a row could be changed by something other than `saveTranslation`.
