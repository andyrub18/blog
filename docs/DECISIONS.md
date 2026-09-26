# Decisions

Settled decisions, with the reasoning that produced them. Revisit only with a
reason; do not silently re-litigate.

_Last updated: September 2026._

## D1 — Article visibility defaults to public

New articles are `public`; `members` is the deliberate exception. A movement
whose purpose is national influence should not hide its output behind a signup
wall. Public articles are the ones search engines index, so this column is
effectively KLEA's reach policy.

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
KLEA**, and `MIN_LANGUAGE_SUPPORT` in `src/lib/deliberation.ts` is where it
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

Settled with KLEA before the phase was built, and recorded here because each one
could plausibly have gone the other way.

**One discussion per article, not one per language.** D12 splits *publication*
by language; it does not split the work. A Creole thread and a French thread
under the same article would divide the movement's own argument, and the smaller
room is the one that goes quiet. Each post records the language its author was
reading, so the distinction is kept without being enforced.

**Readers and above post; anonymous visitors read.** Exactly the roles table in
`phases/01-ENROLLMENT.md`. Reading must never require an account (D1); speaking
under KLEA's article requires one that has verified an email and passed a
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

## D22 — Any interface language is also a content language

`LOCALES` is `fr`, `ht`, `en`, `es`, and an article may be written, reviewed and
published in any of them. There is one list, not two.

Phase 6 briefly shipped two. The reasoning was that `deliberation.ts` publishes a
language only once an assigned contradictor has argued *in that language*, and
that a circle deliberating in Creole and French has nobody to staff a Spanish
adversarial review — so a Spanish draft would be writing with no way out, and the
platform should not offer what the process cannot finish.

That was a restriction nobody asked for, and it was reverted. **Nothing in the
manifesto bans an article in English or Spanish.** The constraint that prompted
the split already enforces itself: a translation no contradictor reads simply
never publishes, and `decide()` needs no help refusing it. A second gate in
`article-actions.ts` added nothing except a decision taken away from KLEA.

The general rule this leaves: `CLAUDE.md` says a manifesto rule must not be
*simplified* without a decision from KLEA. Adding one nobody asked for is the same
error, and harder to notice, because the code looks more careful afterwards.
Before encoding a limit on who may write, review, publish or join, check it is
written down. If it is only inferred from surrounding code, leave the door open.

What remains true, and is a fact rather than a rule: most articles will be in
Creole and French, because that is who writes them. The reading view's fallback
banner therefore says the same thing in all four languages — a reader who asked
for a language this article lacks is looking at a gap an author may close,
whichever language it is.

## D23 — A link KLEA sends carries the language it was sent in

Paraglide resolves locale from the URL first, then a cookie, then the browser's
`Accept-Language`. An unprefixed URL therefore hands the choice of language to
the reader's browser.

That is right for the site root, where we have no better signal. It is wrong for
a link inside a message we wrote: the invitation email was rendered in French
and, once `en` was registered, opened an English registration form for anyone
whose browser preferred English. Nothing had changed except that `en` existed —
before, every unprefixed URL fell through to the base locale and the mismatch
could not occur.

Invitation links are now localized with the same locale as the email that
carries them. The general rule: **an unprefixed URL is a decision, not a
default.** Before emitting one, ask whether the language should follow the
reader's browser or the message it came in.

Not yet applied to the email-verification callback, which Better Auth builds;
that is an auth-flow change and belongs with the P0 that retires the mock Google
sign-in path.

## D24 — Long-form work is an article, not a PDF

A proposal for reforming the public administration is fifty pages and does not
fit the shape of an essay. It is still one article: nothing caps a body's
length, and `article_translation.content_json` holds a document of any size.

Publishing it as a PDF instead was considered and refused. A typeset PDF is
200 KB–2 MB against a reading view budgeted at 100 KB of client JS for readers
on metered Haitian mobile data, and a fixed A4 column is unreadable on the phone
most of them arrive with. Three further things break, and they matter more:

- **Review.** `decide()` diffs ProseMirror JSON between rounds, and that diffing
  is what the adversarial stage runs on (D10). The document most in need of a
  contradictor would be the one format a contradictor cannot work in.
- **Argument.** A forum post can link to `#indicateurs-de-reussite`. It cannot
  link to page 23 of a PDF, and a proposal lives or dies on people arguing with
  a named section rather than the whole text.
- **Reach**, which is the point (D1). A PDF is far worse at it than HTML.

What makes a long article navigable rather than merely long is the contents list
and an anchor per heading, both added here. Anchors are derived from the heading
text, so they survive being pasted into WhatsApp; the cost is that renaming a
heading on a published article breaks links already shared, which is the same
class of problem `article_revision` exists to make visible.

A typeset PDF remains legitimate as a **companion download** — KLEA's own work, so
no rights question; a deliberate download, so outside the budget; served as an
attachment, never inline. When built, it belongs on `article_translation` (the
French and Creole PDFs are different documents), carries the `article_revision`
it was built from, and stops being served when the article has moved on: a stale
companion is a published position nobody decided on, and "no PDF" is recoverable
where "wrong PDF" is not.

**What would flip the PDF-only question:** a document whose substance is layout —
a budget annexe of dense tables, or work where the mathematics is the argument.
The allowlist has no image or math node, so such a document cannot be carried as
an article today either way. `pandoc --mathml` is the cheap answer for the second
case, because MathML is text and renders natively with no client JavaScript.

## D25 — A state the server knows is a state the page can show

Five dead ends were fixed together because they were one mistake wearing five
faces: the server knew what had happened and the page did not say it, so the
person was left with nothing to press.

**An account that exists is never reported as failed.** Better Auth's
`sendOnSignUp` sends the verification mail inside `signUpEmail`, after the user
row is written, and our callback throws when the mailer refuses — deliberately,
because a silently undelivered verification mail looks to the applicant like the
account never worked. That throw escaped into the catch around sign-up and
returned `UNEXPECTED` for an account that had been created. The applicant was
told to try again and could not: the address was taken. `runSignUp` now sends the
mail itself and reports `verificationSent` next to `ok: true`. Either half of the
truth alone is a lie — "failed" hides an account, "created" hides an undelivered
mail.

**The only door into a new account is one email, so there is always a way to ask
for it again.** `resendVerificationEmail` had been written and rate-limited since
phase 1 and nothing called it. It is offered wherever an account is known to
exist unverified: the registration confirmation, and the sign-in form that
refuses an unverified account — which is where somebody whose mail never arrived
actually turns up, having found that registering again is refused too. The
control is shown whether or not the first mail went out, because "sent" only ever
means the mailer accepted it.

**A spent invitation is not a broken one.** `inspectInvitation` always returned
the reason; the page showed one panel for every reason, so the commonest case by
far — a new member reloading the page they just registered on — read as
"invitation unusable", sending someone who already had an account back to their
sponsor for an invitation they had just used.

**A filed application is a state of `/apply`, not a redirect away from it.** The
eligibility guard sent an ineligible visitor home, and filing an application is
what makes you ineligible to file one: `ApplyForm` called `router.invalidate()`,
the guard re-ran, found the dossier it had just created, and redirected over the
panel confirming it arrived — about 75ms on an idle machine, and often no frame
at all. Someone who has just uploaded three PDFs and two essays on a metered
connection reads a silent bounce as failure and files again. `APPLICATION_OPEN`
is now a page; the other two refusals still redirect, because a member has
nothing to apply for and an unverified address has to be dealt with first.

**A recorded decision is read from the dossier, not remembered by the reviewer's
browser.** `done` was a local signal, so a reload brought the decision buttons
back for an already-approved application, and a second reviewer opening the same
URL never saw the first decision at all. It is derived from `status` now. The
`invalidate()` that follows a decision re-reads the dossier and therefore writes
a second `access_event`, which is correct rather than noise: the page did read it
again, and the log's promise is that every read is in it.

The pattern worth keeping: **a client-side success flag is a claim about the
world that stops being true the moment anything else changes it.** Four of these
five were that flag. Derive from the loader, and the confirmation survives a
reload, a second tab and a colleague.

This also paid for itself in bytes. Moving `/apply`'s check out of `beforeLoad`
took 0.7 KB off the shared entry — `beforeLoad` resolves before the component, so
its server functions sit in the eager route tree, while a `loader` splits with
its route. The reading view gained 0.5 KB of headroom from a fix to the
application form.
