# Phase 5 — The forum

The last of the four objectives in `../OVERVIEW.md`, and the reason the `reader`
role exists at all. `01-ENROLLMENT.md` says a Lektè may "read everything, post in
the forum"; `../SECURITY.md` justifies putting a captcha on reader registration
precisely because that cheap, self-serve account grants forum access. Every
phase so far has assumed this one.

A movement that publishes without a place to argue back is a newsletter. The
manifesto's answer to a disputed position is that it can be contested in the
open, and the forum is where a reader who is not a member gets to do that.

## What was decided before building

Three of these are governance calls and were settled with KLE rather than
assumed. The fourth is arithmetic.

**One discussion per article, each post tagged with the language its author was
reading.** Not one discussion per language. An article is one piece of work
(D12 splits *publication* by language, not the work), and splitting the
conversation would put the Creole readers in one room and the French readers in
another — which in practice means the room with fewer people is the one that
goes quiet. The `lang` column is recorded so a post can be labelled, or later
filtered, without a migration.

**Readers and above may post; anonymous visitors read.** This is the roles table
in `01-ENROLLMENT.md` exactly. Reading a public article must never require an
account (D1); saying something under KLE's article requires one that has
verified an email address and passed a captcha. Restricting the forum to members
was considered and rejected: it would empty the reader tier of its only purpose
and contradict the enrollment path this project encourages — read first,
take part in the forum, then apply.

**Posts appear immediately and are moderated afterwards.** Pre-moderation was
rejected on the same grounds as the publish button in D15, but pointing the
other way: a queue that must be drained by senior members before anyone sees a
reply is a forum that dies quietly, and the senior members are already carrying
application review, article review and promotion votes. Moderation is therefore
*after* the fact, with a written reason, in the audit trail — the manifesto's
posture everywhere else in this codebase.

**The discussion is not on the article page.** See below; this one is the
budget.

## Where the forum lives, and why it is a separate page

The reading view is the page the 100 KB budget exists for, and it had 2.7 KB of
headroom when phase 4 shipped. Anything interactive placed on it competes with
the article itself for a reader's metered data.

So the split is:

| | Article page | `/articles/{slug}/discussion` |
|---|---|---|
| Rendering | Server, as now | Server first, then live |
| Client JS | None of its own | The poller and the composer |
| Shows | The latest few posts, static, and a count | The whole thread |
| Can post | No — a link | Yes |

A reader who only wants the article pays nothing for the forum. A reader who
wants the argument opens a second page, which is a fair place to spend bytes —
the same bargain the editor makes in phase 2.

The tail on the article page is worth more than it costs: a published article
with a visible "14 responses" is an invitation, and one with a silent link is
not.

## Posts are plain text

Not ProseMirror. The document format exists because articles need structure and
because a contradictor has to diff round two against round three; a forum post
needs neither. Reusing it would put a parser and a renderer on the discussion
page, and would start an argument about which nodes a comment may contain that
ends with somebody asking for images.

Stored as text, rendered as text. Paragraphs come from blank lines, and the
component emits **text nodes** — there is no `innerHTML` anywhere in the forum,
so there is no escaping to get wrong. The reading view's `innerHTML` is safe
because the server's renderer wrote every tag of it; a forum post is written by
whoever registered five minutes ago, and gets no such treatment.

Links are not turned into anchors in this phase. Autolinking a forum in an
environment where phishing a member's session is a plausible attack is a
feature that needs its own thought, and plain text costs a reader one copy and
paste.

## Rules

**Read access follows the article.** The discussion on a `members` article is
visible to the same people the article is, via the same `canRead`. A forum that
answered "here are 40 replies" about an article it would refuse to show is a
side channel around D1, and the replies quote the article.

**Every server function re-checks the caller.** As everywhere else: a route
guard is UX, a `createServerFn` is a public HTTP endpoint. The post endpoint is
the one somebody would call directly.

**Rate limited by account, not by address.** One IP here is a cybercafé, an
office, or a mobile carrier behind NAT — the reasoning that made the sign-in
limit deliberately loose (`../SECURITY.md`, item 24). Charging a neighbourhood
for one person's flood is the mistake that rule exists to avoid, and the poster
is authenticated, so there is a better key available.

**One level of replies.** A post, or a reply to a post. Arbitrary nesting is a
rendering problem, a moderation problem — hiding a post orphans a subtree — and
a mobile layout problem, in exchange for a distinction people mostly do not
use.

**Deleting hides; it does not erase.** An author may withdraw their own post and
a senior member may hide one with a written reason. Both leave the row in place
with a changed status. A thread that silently loses a post tells the people who
answered it a lie about what they were answering.

**Blocked accounts cannot post**, and this needs no new code: blocking deletes
their sessions in the same transaction, sign-in refuses them by name, and
`requireUser` refuses them as a backstop. It is worth a test anyway, because
that is three places that have to keep agreeing.

## Schema

```
forum_post
  id            text pk
  article_id    text -> article(id) on delete cascade
  lang          text            -- what the poster was reading
  author_id     text -> user(id) on delete cascade
  parent_id     text -> forum_post(id) on delete cascade, null for a top-level post
  body          text
  status        visible | withdrawn | hidden
  created_at    timestamptz
  edited_at     timestamptz null   -- the author corrected it, and the thread says so
  changed_at    timestamptz        -- any change at all; this is what the poller asks
  index (article_id, created_at), (article_id, changed_at)

forum_moderation           -- append-only, why a post was hidden
  id, post_id, actor_id, action, rationale, created_at
```

`forum_moderation` rather than a column on the post: the audit trail in this
codebase is append-only everywhere else (`role_change`, `access_event`), and a
`hidden_reason` column overwritten on the second decision would lose the first.

No `access_event` rows for reading the forum. That table exists for privileged
reads of somebody else's data — a CV, an application — and a public discussion
is not that. Logging every read of a public page would bury the rows that
matter, which is the failure mode of an audit log nobody can read.

## Live, without WebSockets

The roadmap's standing rule, kept: polling, then Server-Sent Events over
Postgres `LISTEN/NOTIFY` if polling is genuinely not enough. WebSocket
infrastructure is a deployment burden this project has not earned.

Polling on a metered connection has to be written with the connection in mind:

- Only while the tab is visible. A forum tab forgotten in a browser on mobile
  data must not keep billing its owner.
- Backing off while nothing arrives, and resetting when something does.
- Stopping altogether after a long idle stretch, with a manual refresh offered.
- Fetching only what is new, by `since`, not the whole thread each time.

## Tests

- **unit** — the validation rules and the paragraph splitting.
- **db** — threading, the visibility inheritance, moderation transitions, and
  that a blocked account is refused. This is where correctness lives in SQL.
- **e2e** — post, see it appear, moderate it; and the budget assertion, extended:
  the article page must not request the discussion route's chunk.

## Not in this phase

Email notification of replies, reactions, per-thread subscriptions, and
reader-facing reports. Reports in particular are a real requirement and are
deliberately held back: a report queue nobody watches is worse than no button,
and this phase is already asking senior members for new attention.

An author may correct their own post, and the correction is marked — that much
is in. A time-limited editing window is not: it is a rule about when people are
allowed to fix a typo, and `edited_at` already tells the thread what it needs to
know.

---

## What phase 5 built

`src/lib/forum.ts` is the rules and `src/lib/forum-actions.ts` the endpoints;
`src/components/forum/` is the thread and the box people type into. It follows
the plan above, with three things worth recording.

### The tail rides on the article's own query

`fetchArticle` returns the count and the last three posts alongside the article,
rather than the page asking for them. The reading view runs no JavaScript of its
own, so a second request would be a second round trip on the connection this
project is written around — and the authorisation is already done: whoever may
have the article may have its tail, decided once by `canRead`.

The excerpt is cut to 240 characters on the server. A post may run to four
thousand, and three of those under an article would make the invitation longer
than some articles.

### `changed_at`, not `created_at`

The poller asks "what changed since?" against its own column. Polling on
`created_at` would return only new posts, and a post a moderator had just hidden
would stay on screen in every tab that already had it — which is precisely the
case moderation exists for. `forum.db.test.ts` holds that behaviour: a hidden
post comes back in the delta.

### The budget measurement was wrong, and the reading view was never over

`npm run budget` matched route files by prefix, so `…/articles/$slug` also
matched `…/articles/$slug_/discussion` and charged the reading view 6 KB for a
page it only links to. It reported 105.3 KB — over budget — for a page that was
at 99.1 KB. The matcher is now anchored on `.tsx`.

A measurement that silently counts a neighbouring route is worse than no
measurement, because it is believed. This one would have been believed into
either a pointless optimisation or an abandoned feature.

### What it costs

| Page | Before | After |
|---|---|---|
| Shared entry | 94.5 KB | 95.3 KB |
| `/articles/{slug}` — the reading view | 97.3 KB | **98.7 KB** |
| `/articles/{slug}/discussion` | — | 102.6 KB |

The reading view keeps the budget with 1.3 KB of headroom. The forum page does
not, and is not held to it: at 102.6 KB it is the 95.3 KB shared entry plus 6 KB
of thread, on a framework floor of roughly 81 KB. Any interactive page on this
stack lands there. It is a page a reader opens on purpose from an article they
are already reading, which is the same bargain the editor makes — and unlike the
editor it is 6 KB, not 126.

**The trend to watch is the entry**, which grew 0.8 KB for a route most readers
never open, because every route's non-component module sits in the entry graph.
Phase 6 adds locales rather than routes, so it should not repeat.

### Still to do

`forum_moderation` is written and nothing reads it yet. The record exists so a
hidden post can be accounted for; a screen that shows senior members what has
been hidden and why is the obvious next piece, and `listModerations` was written
and then removed rather than shipped unused (D17).
