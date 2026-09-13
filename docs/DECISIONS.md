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

**Superseded in part by D15:** nobody publishes their own article now, author or
not. The reasoning below is why the constraint existed before the process did.

`publishTranslation` required a senior member. The manifesto does not let an
author decide that their own proposal has been accepted, and phase 3's
submission workflow put a documented proposal and assigned contradictors behind
that judgement.

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

## D15 — Publication is a decision, and there is no publish endpoint

Phase 3 removed the senior-member publish action entirely. A language of an
article goes live because `decide()` found that it cleared the threshold, and
there is no other code path that sets a translation to `published`.

This is stricter than it needs to be for convenience and exactly as strict as it
needs to be for the thing to mean anything. An endpoint that let one senior
member publish would be a way around the whole deliberation, available to
precisely the people the deliberation is meant to constrain — and it would be
used, because it is faster.

Withdrawing a language stays a single editorial act. A correction that needs
three people and a week is a correction nobody makes. Putting it back means
another round, because that is a publication decision again.

## D16 — One language's threshold is an implementation choice, not the manifesto

The manifesto sets the quorum for a deliberation: three assigned reviewers, at
least one a contradictor. It does not say what a single language of a
multilingual article needs on its own, and the platform cannot publish anything
without an answer.

The rule implemented is: a contradictor must have spoken on that language, at
least two members must support it, and supports must reach two thirds of the
votes cast on it. Requiring the full quorum of three per language was rejected
because it would make a Creole translation unpublishable whenever only two of
the assigned reviewers read Creole — quietly turning the movement's second
language into its optional one.

Recorded here because it is the one governance rule in this codebase that the
implementation invented. **It should be confirmed or replaced by a decision from
KLE**, and `MIN_LANGUAGE_SUPPORT` in `src/lib/deliberation.ts` is where it
changes.

## D17 — No dependency ships before a feature needs it

TanStack Query was added by the project scaffold, wired into the router context,
and shipped to every reader for three phases without a single call site — 6.6 KB
gzipped on a 100 KB budget, which is most of the headroom that had gone missing.

The rule this leaves: a dependency earns its place when a feature needs it, not
when a template suggests it, and the check is `npm run budget` rather than
intuition. The roadmap plans Query for phase 5's forum polling; when that
arrives it goes in scoped to the forum routes, not into the router context where
it lands on every page including the ones with no queries at all.

The same reasoning applies to anything else the scaffold left behind. An unused
dependency is not free: it is bytes on a metered connection, a supply-chain
surface, and a pinned release candidate somebody has to keep upgrading.

## D18 — An importer that rebuilds, rather than a sanitiser that cleans

Mammoth states plainly that it sanitises nothing, and that a Word file can carry
a `javascript:` link which becomes executable if the output is embedded
uncleaned. The conventional answer is an allowlist sanitiser over the HTML,
followed by a parse into the editor's schema.

`html-to-prosemirror.ts` does the two in one pass instead, and not to save a
step. Nothing in it copies a tag through: every node is rebuilt from the
vocabulary in `prosemirror.ts`, so an element with no entry in its tables cannot
produce anything at all, whatever it contains. A sanitiser must enumerate what
is dangerous and is wrong whenever that list is incomplete. This enumerates what
is allowed, which is a list we already maintain for the editor, and the output
is structured JSON rather than HTML — so there is no markup to get wrong.

It also avoids TipTap's `generateJSON`, which would mean running the editor and
a DOM implementation on the server to re-derive an allowlist we own.

## D19 — Tables are content; images are a pipeline

Phase 4 added tables to the document format — nodes, renderer, editor extension,
import mapping — because a budget line against a year is the one Word structure
that cannot honestly be rewritten as prose.

Images are counted in the import report and dropped. Mammoth's default is to
inline each one as a base64 `data:` URI, which would bloat the stored row and
every page load of the published article. The alternative is storage, and D11
says that is managed object storage, which does not exist yet.

The deeper reason to wait is that "images work" is not the same feature as an
`<img>` tag. For a reader on metered Haitian mobile data, images are the bill —
the roadmap says so — and doing them properly means re-encoding to strip EXIF,
AVIF or WebP, `srcset`, explicit dimensions and lazy loading below the fold.
Shipping an `<img>` now would spend the hard part's budget without doing the
hard part. Until then the author is told plainly that their images were not
taken, which is the honest half of the feature.

## D20 — The forum polls by hand; TanStack Query did not come back

The roadmap planned to reinstate TanStack Query in phase 5, scoped to the forum
route, for polling. It was not reinstated, and the rule that removed it in the
first place is the reason (D17): a dependency earns its place when a feature
needs it.

`@tanstack/solid-query@6.0.0-rc.3` does support Solid 2 RC, so this was a choice
and not a constraint. What the forum needs is one loop that asks "what changed
since?" and merges the answer, and the loop it needs is not the loop Query's
defaults give: it must ask for a delta rather than the thread, stop dead while
the tab is hidden, slow down while nothing is happening, and give up after ten
quiet minutes. Most of that is turning Query's behaviour off, and all of it is
about forty lines of `setTimeout` in `DiscussionThread.tsx`.

The cost avoided is small — around 6 KB gzipped on a page already at 102 KB —
but it is 6 KB, a supply-chain surface, and another pinned release candidate to
keep in step with Solid and TanStack Start. Optimistic posting, the other thing
Query was wanted for, is a temporary row in a signal, replaced by the row the
server returns.

**What would flip this:** a second and third polled surface — notifications, a
live review queue — at which point the caching and deduplication become shared
infrastructure rather than one screen's forty lines.

## D21 — The forum's three governance rules

Settled with KLE before the phase was built, and recorded here because each one
could plausibly have gone the other way.

**One discussion per article, not one per language.** D12 splits *publication*
by language; it does not split the work. A Creole thread and a French thread
under the same article would divide the movement's own argument, and the smaller
room is the one that goes quiet. Each post records the language its author was
reading, so the distinction is kept without being enforced.

**Readers and above post; anonymous visitors read.** Exactly the roles table in
`phases/01-ENROLLMENT.md`. Reading must never require an account (D1); speaking
under KLE's article requires one that has verified an email and passed a
captcha. Restricting the forum to members was rejected: it would leave the
reader tier with no purpose and contradict the path this project encourages —
read first, take part, then apply by dossier.

**Posts appear at once and are moderated afterwards, with a written reason.**
The mirror image of D15. There, the constraint is that no one person may publish
in the movement's name; here, the constraint would cost more than it buys — a
queue drained by the same senior members who already carry application review,
article review and promotion votes is a forum that dies waiting. Hiding a post
writes a rationale to `forum_moderation` in the same transaction as the status
change, and nothing is ever deleted.
