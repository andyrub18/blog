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
KLEA**, and `MIN_LANGUAGE_SUPPORT` in `src/lib/deliberation/deliberation.ts` is where it
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

The email-verification callback, which Better Auth builds, followed with the P0
that retired the mock Google sign-in (D27): `sendVerification` in
`auth-actions.ts` passes a `callbackURL` localized with the email's locale.

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

## D26 — The companion PDF: kept, not rebuilt, and offered only while it is true

D24 decided that long-form work is an article and that a typeset PDF may sit
beside it as a **companion**. This is how that was built, and the four choices
that were not obvious.

**Tied to a revision, served only while it matches.** An author attaches a PDF
to one language; the row records the newest `article_revision` of that language
at that moment. The reading view links it and `/api/companion/<slug>/<lang>`
serves it only while that revision is still the newest — one query,
`servableCompanion`, answers for both, so the link can never point at a file the
route would refuse. Any save writes a revision, so any save retires the PDF,
including a save that changed nothing: we compare revisions, not documents,
because "the text moved on" should never depend on a diff being right. Stale is
a 404, not a 410 and not the old file: a forwarded link to an outdated PDF gives
nobody the outdated PDF. Publication writes no revision, so a PDF attached to
the draft the circle reviewed goes live with it.

*Amended by D30:* readers now see a language's approved revision rather than
its working copy, so a draft save no longer retires anything — the approved PDF
still describes the approved text on the page. A companion goes stale when a
round publishes a newer text.

**Kept, not rebuilt — so what it may contain is narrower instead.** Everything
else the platform ingests is rebuilt from an allowlist (D18). A companion cannot
be: its typesetting is the reason it exists, and a PDF we regenerated would be
worse than the author's own `pdflatex` output (D24). `lib/articles/companion/pdf.ts` therefore does
two things and says so to the author afterwards:

- **Refuses what can act** — JavaScript, launch, submit and import actions,
  links into other files, embedded files, forms, rich media, and any link that
  is not `http`, `https` or `mailto`. Also refuses comments and other markup
  annotations, for a different reason: a PDF that went round the circle can
  carry reviewers' notes with reviewers' names in `/T`.
- **Strips what identifies** — the information dictionary, every XMP packet,
  Acrobat's `PieceInfo`, pdfTeX's `PTEX.*` keys (the absolute path of every
  included figure, which on a laptop begins `/home/<username>`, and each
  figure's own information dictionary), the EXIF inside embedded JPEGs
  (`pdflatex` copies a photo's bytes verbatim, GPS position included), and every
  object nothing references any more, which is where an incrementally saved file
  keeps what each edit replaced.

None of the stripped things is visible on the page, which is exactly why an
author checking their own file would never find them — and SECURITY.md's case
for a pseudonymous byline is worth nothing if the PDF beside the article names
its author in its properties. The information dictionary is rebuilt with one
entry, the article's title, so a reader's viewer shows that.

Not attempted, and said in the code: white text, content hidden under an image,
optional-content layers. Those are what the author put on the page.

**Who may attach one: whoever may edit the text** — `canEdit`, the same rule as
saving. **Who may put one in front of readers: the circle** — see D29, which
replaced this paragraph's original answer. As first built, an attached PDF went
live on its own, on the reasoning that nothing written down required more. KLEA
answered that documents are reviewed before publication and that a reviewer must
be able to verify the PDF too.

**Downloads are not logged; uploads are.** A dossier read is logged because it is
a privileged look at someone's private file. This is a reader taking a public
document home, and a list of who downloaded a political proposal is precisely the
list the movement's adversaries would want to obtain. The accountable act is the
upload, and it is recorded: rows are append-only like revisions — replacing or
removing one closes it (`superseded_at`, `superseded_by`) rather than deleting
it — and each carries the `sha256` of the served bytes, so anyone holding a copy
of a disputed PDF can check whether KLEA served it. The superseded *bytes* are
deleted; the record of them is not.

**`pdf-lib` 1.17.1, not the maintained fork.** `pdf-lib` has not been released
since 2022. `@cantoo/pdf-lib` is maintained, but brings an HTML parser and a
colour library on open `>=` ranges, is 26 MB unpacked and releases every week or
two — more supply chain than a server-side metadata pass needs, on a project that
pins everything. The tradeoff is a parser nobody is patching, run on bytes from
outside. It is bounded: only a member with edit rights can upload, at ten an hour,
and the file is capped at 20 MB before it is parsed. What is not bounded is an
object stream that inflates enormously — pdf-lib decompresses with no output
limit — so a hostile member could cost the server memory. Revisit if uploads
ever open wider than members, or move parsing into a worker with a heap limit.

One trap met on the way, recorded because it fails silently: pdf-lib is compiled
to ES5, where subclasses of `Error` do not survive `instanceof`. Catching
`EncryptedPDFError` by class never matched, and an encrypted file was reported as
unreadable. Encryption is now read from `doc.isEncrypted`; never `instanceof` a
pdf-lib error.

**Cost to readers: 0.1 KB.** The link is server-rendered markup prepended to the
article HTML, like the contents list, so the reading view ships no new
component. The 0.1 KB is the new API route's entry in the route tree. The
author's `/write` page grew 5.3 KB, most of it 34 messages in four languages,
on a screen the budget exempts.

## D27 — No social sign-in

The login page carried a "Continue with Google" button from the original
scaffold. It was never wired: `mockGoogleSignIn` returned `NOT_IMPLEMENTED` and
the button waited 400 ms and said Google sign-in was coming soon. It is removed,
along with the server function and its messages, rather than finished.

**The reason is the enrollment.** An account on this platform is not a
convenience login; it is the thing the movement's admission process is attached
to. A reader registers with a name, an email, a birth year and an essay, and
verifies the address; a member is admitted on a dossier and a human decision.
A one-click identity from an outside provider fits none of that — it would be a
second door into accounts whose whole point is that there is one, deliberately
narrow, way in. That is KLEA's call, made here.

It also happens to be the safer arrangement for this threat model: a social
login would put a record of who holds a KLEA account with a third party, and
tie each member's access to an account the movement does not control. That is a
consequence, not the reason.

Removing the button also retired the `info` slot on the login form, which only
ever showed "coming soon".

The same change finished what D23 deferred to it: the verification email's
link now lands in the email's language. Better Auth's link verifies at
`/api/auth/verify-email` and then redirects to `callbackURL`, which defaulted to
an unprefixed `/` — so the page after verifying came up in the browser's
preferred language, not the email's. `sendVerification` in `auth-actions.ts` is
now the single way the mail is sent, and passes a localized callback.

## D28 — `/api/*` is outside locale routing, and is tested by navigating

Found while checking D27's change by hand, not by any test: **no one could verify
an email address by clicking the link in the verification email.** The link
opened a 404.

Paraglide's middleware, with the `url` strategy first, redirects a *page
navigation* (`Sec-Fetch-Dest: document`) whose path has no locale prefix to the
prefixed form. It applied that to API routes like any other path:
`/api/auth/verify-email?token=…` was answered with a 307 to
`/fr/api/auth/verify-email?token=…` — or `/ht/`, `/en/`, by cookie or browser —
which does not exist. The same redirect broke a reviewer's click on a dossier
download (those links are plain navigations) and anyone opening a companion
PDF's URL directly. Clicking the PDF link on an article was spared only because
it carries `download`, which browsers do not send as a page navigation.

It stayed hidden for two reasons, both worth keeping in mind:

- **Every test fetched these URLs; none navigated to them.** The middleware
  never redirects a fetch. The companion e2e downloaded the PDF with
  `page.request.get` and passed while the same URL, opened in a tab, 404'd.
- **No verification email had actually been delivered.** The development Resend
  key was set with a sender on an unverified domain, so every send failed
  before anyone could click anything.

The fix is Paraglide's own: `routeStrategies: [{ match: '/api/:path(.*)?',
exclude: true }]` in `paraglide-options.ts`. Excluded routes still run inside a
locale scope, pinned to the base locale; nothing under `/api` renders text for a
person, and the verification email is sent from a server function, which keeps
the request's real locale. `e2e/api-routes.spec.ts` navigates to each API route
with a locale cookie set, and fails without the exclusion.

## D29 — The circle reviews the companion PDF with the text

KLEA's answer to the question D26 left open: **documents are reviewed before
publication, and a reviewer must be able to verify the PDF as well as the
text.** A companion now reaches readers only through a decision.

**The rule.** When `decide()` accepts a language, `approveCompanions` stamps the
current companion of that language with the round (`approved_in_submission_id`,
`approved_at`) — but only if it was attached **no later than the round was
submitted** and is **still made from the newest text**. `servableCompanion`
serves only stamped files. Everything else waits, and the author's editor says
which of five states it is in: approved, in review, waiting for the next round
(attached after this round was submitted), awaiting review (no round open), or
stale (the text changed after it was attached).

"Attached before submission" is the line because it is the only moment the
platform can say the circle *had* the file. A PDF swapped in mid-debate, after
some reviewers downloaded the old one, would otherwise be approved by verdicts
given on a different document.

**What reviewers get.** The submission page lists every language of the round
with its PDF's state, and a download for the one under review —
`/api/companion/review/<submissionId>/<lang>`, served to members (the same
audience as the page itself), `private, no-store`, as an attachment. Not
logged: it is the author's proposal, not somebody's private file. The same
route file as the reader's download, because every route costs every page a few
hundred bytes of route tree.

**Replacing an approved PDF withdraws it** from readers until a round approves
the new one — there is one current companion per language, and an unreviewed
file cannot be current and served at once. The editor warns before it happens.
That is a real cost for an author who only wants to fix a typo in the typeset
version, and the price of the rule: the fix is a new round for that language.

**A new round no longer takes a live article offline.** Making "the next round"
the way back for a PDF surfaced a bug that was there all along: the review flow
wrote its stage into `article.status` unconditionally, so submitting a language
of an already-published article — the Creole after the French, D12's normal
case — set the article to `submitted` and the reading view, which serves only
`published` articles, dropped the French for the whole review, and for good if
the Creole was refused or withdrawn. `stageFor` in `article-review.ts` now keeps
an article `published` while any translation is, which is what
`withdrawTranslation` had always assumed the column meant. Covered by
`article-review.db.test.ts`, which failed before the fix.

**Not changed, and worth a decision of its own.** The same principle — reviewed
before publication — is not yet enforced for the *text*. A submission does not
record which revision the circle read: an author can still edit a language after
the verdicts are in and before the decision, and `decide()` publishes whatever
text is current; and a published language can still be edited without a round.
The companion is protected from both by its revision check. The text is not.

*Decided in D30:* the text follows the same rule.

*Superseded in its mechanism by D31:* the approval stamp and the "attached before submission" timing rule are gone. A version records which PDF it carries, and the PDF is approved exactly when its version is. The rule itself — the circle reviews the PDF with the text — stands.

## D30 — A published text changes only through the circle

KLEA's decision: **the text must be protected, and a modification must be
reviewed — the nature of the movement asks for it.** D29 applied that to the
companion PDF and noted the text did not follow it. Now it does.

**A round records exactly what it was given.** `submitForReview` stores the
newest revision of each submitted language in `article_submission.revision_ids`.
That is the text reviewers read — the submission page now shows it, rendered,
language by language — and it is the only text the round can publish: `decide()`
pins `article_translation.published_revision_id` to it. An author who keeps
editing after submitting is editing the next round's text; the editor says so,
and so does the review page, to reviewers, so nobody argues about a version they
cannot see.

**Readers see the pinned revision, never the working copy.** The reading view,
the article index and the discussion page all read title, summary and body
through `published_revision_id`. An author may go on editing a published
language — every save is kept as a revision — but those saves are a draft,
named as one in the editor, until a new round accepts them. Before this, a save
on a published article went live at once, and a decision published whatever the
working copy said at the moment of deciding.

**The submission page did not show the text at all.** Found while building this:
reviewers voted on a document the platform never put in front of them, and a
panel member below senior could not open the draft anywhere. It now renders the
submitted revision of each language, server-side, with the same guarantee as the
reading view — `renderDocument` wrote every tag.

**The companion follows the published revision.** Approved when its revision is
the one the round reviewed; served while that is the revision readers see. So a
draft save no longer retires an approved PDF (the reader still sees the text it
describes), and a new published text without a new PDF does.

**Existing data.** Migration `0011_protected_text` pins every published language
to its newest revision — what readers were seeing, since until now they saw the
working copy — and records, for every round still open, the text as it stands.
Decided rounds are history and are left without a snapshot. The backfill is
tested against rows shaped like the old data (`migrations.db.test.ts`), because
the harness applies migrations to an empty database and would never catch an
`UPDATE` that pinned the wrong thing — which here would take every published
article off the site.

**What this does not do.** It does not stop an author editing during a review;
nothing needs stopping, since the edits cannot reach readers. There is no way to
discard a draft and return the working copy to the published text, and no view
of what changed between the published text and the draft; both would help an
author and a panel, and neither is needed for the rule to hold.

*Superseded in its mechanism by D31:* `published_revision_id` and `revision_ids` became versions (`published_version_id`, `article_version`). The rule — readers see only what the circle approved — stands, and the missing view of what changed now exists.

## D31 — Versions: what the circle approved, numbered, and what changed

KLEA's decision: **the text has versions, per language, and the highest
approved version is the one published; a version covers the text and the
companion PDF together.** Readers see which version they are reading, and what
changed. Changes are shown against the previous version, whatever its outcome.

**A version is made when a language is submitted,** not on every save — every
save is still a revision, and forty saves are not forty versions. It freezes the
two things the circle reviews: the text, and the author's PDF if it was made from
exactly that text. The round's decision approves or refuses the version as a
whole; a withdrawn round leaves its versions `withdrawn`. Numbers are per
language, from 1, and every submitted version takes one whatever becomes of it,
so "version 3" means the same thing to an author, a reviewer and a reader.

**The published version is the highest approved one.** `decide()` pins
`article_translation.published_version_id` to the version it approves; because
an article has one open round at a time, the version approved now is always the
highest approved. Readers — the reading view, the index, the discussion page, the
PDF download — read through that pointer and nothing else.

**Two comparisons, deliberately different.**

- **The circle** sees version *n* against version *n − 1* whatever became of it,
  as decided: what the author changed in answer to the objections, even when the
  last round refused. The review page shows it for each language, with the full
  text of the version below and its PDF to download.
- **Readers** see approved versions only, each against the previous *approved*
  one. This was not asked for in so many words, and is the one place the rule
  was applied narrowly: a refused version was never published, and comparing a
  reader's version against it would print the refused text as the "removed" side
  of a change — publishing it after the circle refused it, which D30 forbids.
  `versions.db.test.ts` asserts that no refused text reaches a reader's history.

**How changes are shown.** `diff.ts`, pure and server-side: both documents are
flattened into blocks (headings, paragraphs, list items, table rows), the blocks
are aligned — so a paragraph inserted at the top does not make every later
paragraph look changed — and a block removed and replaced by one of the same kind
is compared word by word. A block whose words are the same but whose formatting
changed is marked, not hidden. Long unchanged stretches are collapsed with one
block of context either side. PDFs are compared by their hash: unchanged,
changed, added or removed; a content comparison of two PDFs would be unreliable
and is not attempted. Every character of author text is escaped by `diff.ts`
itself, which is what makes its output safe for `innerHTML`.

**The PDF gets simpler.** It is approved exactly when its version is — the
separate approval stamp and the "attached before submission" timing rule of D29
are gone, replaced by the version recording which file it carries. Replacing or
removing the working PDF no longer withdraws the published one: a file stays on
disk for as long as any version refers to it.

**Cost to readers: nothing, net.** The version line and the history link are
markup in the article's HTML. The history page is a route of its own, and a route
costs every page about 0.5 KB of route tree; the budget said to find the bytes
first. They were found in `/auth/verify`, a page nothing had linked to since the
verification email started landing on Better Auth's own endpoint (D27) — and it
imported the Better Auth client into the graph every page shares. Removing it
took the reading view from 99.0 KB to 98.8 KB with the history page included.

**Existing data.** Migration `0012_article_versions` makes every published
language version 1, approved, carrying the PDF readers were being given, and every
language of an open round the next version, pending, carrying the PDF the round
had from the start. `0013` then drops what versions replace — the D30 pins and
the D29 approval columns. Both are tested against rows in the shape they had
before them (`migrations.db.test.ts`, which can now stop the schema at any
migration): the harness alone runs migrations on an empty database, where a
wrong backfill does nothing, right or wrong.

## D32 — What the deployment gate found

The work before a first deployment — security headers, secure cookies, and a
deployment checklist — turned up three things that were wrong, not just missing.

**The rate limiters could be walked around.** Both ours and Better Auth's took
the client's address from the *first* entry of `X-Forwarded-For`. Proxies append
the address they saw to the end of that header; the first entry is whatever the
client wrote. A client sending a new invented address with each request got a
fresh bucket each time — unlimited password guesses against any member — and the
dossier access log recorded addresses of the client's choosing. The address now
comes only from `CLIENT_IP_HEADER`, a header the reverse proxy *sets*
(`x-real-ip`, or `cf-connecting-ip` behind Cloudflare), for both limiters.
Production refuses to start without it, and refuses `x-forwarded-for` as its
value. Checked against a production build: one client forging the header on
every request is refused after the limit; twelve different real clients are not.

**"Fail at boot" did not fail at boot.** The captcha and mailer guards were
called at the top of `src/server.ts`, which the built server loads on its first
request. A misconfigured production server started, printed "Listening", and
answered every request with a 500 — failing closed, but invisibly to anything
watching the process. The guards now run in `src/boot.ts`, a Nitro plugin, at
startup: every bad configuration tested exits with code 1 and the reason.

**Dossiers ignored `UPLOAD_ROOT`.** Companion PDFs honoured it; dossiers were
hard-coded to `./uploads`. A server with its persistent volume at `UPLOAD_ROOT`
would have kept the PDFs and lost every CV and essay on its next redeploy. One
`uploadRoot()` now serves every upload.

**What was added.** A Content-Security-Policy with a fresh nonce per request and
no `'unsafe-inline'` for scripts: the router already accepted an `ssr.nonce` and
passes it to every inline script it renders, so the only work was getting each
request's nonce to it (`lib/shared/csp-nonce.ts`). It applies to production
builds only — the dev server's scripts carry no nonce — so `e2e/csp.spec.ts`
runs against one, and fails on every page when the nonce is removed. HSTS,
`X-Frame-Options`, `Referrer-Policy: same-origin` (a reader following a link out
of an article does not tell the destination which article), and a
`Permissions-Policy`. Session cookies marked `secure` wherever the site is on
HTTPS, which production now requires. And `docs/DEPLOYMENT.md`: settings, the
proxy, the service, encrypted backups held off the server, a restore test, and
how to replace the auth secret.

## D33 — One server, run by systemd, not containers

KLEA runs on a single OVHcloud VPS under Ubuntu 24.04, chosen by KLEA over
Cloudflare's hosting platform: the app, PostgreSQL and Caddy on one machine,
with encrypted backups copied to a different provider. `deploy/setup-server.sh`
installs and configures all of it — Node, PostgreSQL, Caddy, the firewall, the
database and its password — so nothing is installed by hand
(`docs/DEPLOYMENT.md`).

**Not in Docker.** Considered and set aside by KLEA, for reasons that weigh more
here than on most projects:

- Ports Docker publishes bypass the host firewall. Behind Cloudflare's proxy the
  firewall admits only Cloudflare's addresses; with Docker that rule would
  silently stop applying, and one careless port mapping puts PostgreSQL — every
  dossier — on the internet.
- Host packages receive security updates every night. An image's packages are
  as old as its last build, and KLEA has nobody watching advisories to rebuild.
- Building an image on a 2 GB server needs the memory the build already needs;
  building it elsewhere needs a registry and CI — one more account holding the
  code and the means to deploy it.

The isolation a container would give comes from the systemd unit instead: the
file system read-only except the uploads, no capabilities, `/home` hidden. What
this costs is portability: moving host means running the setup again and
restoring a backup — which the restore test practises anyway.

**The startup guards exit 78, not 1** (D32): `EX_CONFIG`, so systemd restarts the
server after a crash and not after a refusal, which no restart can fix.

**What the rehearsal found.** The whole sequence was run on a throwaway Ubuntu
machine before any real one existed. Besides fixes to the scripts themselves, it
found that a `HEAD` request held its rendered page in memory for two minutes:
TanStack Start answers `HEAD` like `GET`, with a stream that frees itself when
read or when a 120-second timer runs out, and a `HEAD` body is never read. Two
thousand of them added 150 MB — a loop of cheap requests could fill a 2 GB
server — and the pending timer kept a stopping server alive until systemd killed
it, so every deploy took the site down for 90 seconds. `src/server.ts` now
cancels the body of every `HEAD` response (`lib/shared/head-request.ts`), and the
database pool closes when the server does (`lib/db/shutdown.ts`): memory stays
flat, and a restart takes a second.
