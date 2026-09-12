# Phase 1 — Enrollment and promotion

> **Status: built.** Every flow below is implemented and covered by Postgres
> integration tests and end-to-end tests against a real database: the schema,
> the reader-to-member promotion path (`/apply`), the eligibility rules, the
> senior-member review queue, promotion on approval, the six-month probation
> clock and its confirmation decision, the access-logged dossier download,
> promotion to senior member by qualified majority, cooptation by invitation,
> and blocking.
>
> The UI is deliberately plain, and progressive enhancement (forms that work
> without JavaScript) is deferred to a later pass.

The membership ladder in the app must be the membership ladder in the manifesto, using the
same words in all four languages. Otherwise people carry a translation table in their heads
and permission bugs follow.

## Roles

| Role | Manifesto term | Can |
|---|---|---|
| _(anonymous)_ | — | Read `public` articles |
| `reader` | Lektè | Read everything, post in the forum |
| `member` | Manm | Propose articles, review when assigned |
| `senior_member` | Manm senyò | Decide on submissions, moderate, review applications, block |
| `super_admin` | — | Operate the system |

This renames the current `core_member` → `senior_member` and keeps `member` as the writer
tier. It matches the manifesto, which admits everyone by dossier as a *membre* and forms
the admission committee from *membres séniors*. Do the migration before articles exist.

## Separate role from process

Today `role` and `memberStatus` both live on `user`. Keep `user.role` as the single source
of truth for *what you can do right now*, and move everything about *how you got there* into
application and audit tables. A promotion is then just an application filed by an existing
reader — the same machinery, not a second code path.

One schema fix, **now applied** in `drizzle/0003_enrollment.sql`:
`member_application.userId` carried a plain `UNIQUE` constraint, which permanently blocked
anyone rejected once. It is replaced by a partial unique index, so a user may have only
one **open** application but keeps a full history:

```sql
CREATE UNIQUE INDEX one_open_application_per_user
  ON member_application (user_id)
  WHERE status IN ('pending', 'under_review', 'needs_more_info');
```

## Flow A — Reader registration (self-serve)

Name, email, password (or Google), **birth year**, and a short essay. Email verification is
required before the account becomes usable. On verification: `role = reader`.

Two changes to what exists:

- **Store birth year, not full date of birth.** We need it to know whether someone is a
  minor, which matters for safeguarding. A full DOB is a strong identifier that raises the
  damage of a breach for no added benefit. (`auth-actions.ts` also names its check
  `isAdult()` while testing `>= 13` — pick one meaning and rename accordingly.)
- **Raise the essay minimum from 50 to ~400 characters.** Be explicit about its purpose: it
  gates *forum participation*, not reading. Fifty characters filters nothing.

Reading public articles must never require an account. Reach is the point.

## Flow B — Member application (the dossier)

Two entry points, one pipeline:

1. **At registration** — sign up and apply in one pass (the current member form).
2. **From an existing reader** — "Apply to become a member." This is the promotion path,
   and it should be the *encouraged* one: read first, participate in the forum, then apply.

Both create a `reader` account plus a `member_application` row. The registration path is
just the promotion path with the account creation in front of it.

**Fix the ordering bug.** `signUpMember` in `src/lib/auth-actions.ts` creates the user via
`runSignUp()` and *then* saves the PDFs. If an upload fails it returns an error but the
user account already exists, with no application attached — a stranded account that cannot
re-apply because of the `UNIQUE` constraint above. Validate and stage all three files
first, then create the user and insert the application in one transaction, and only then
move the staged files into permanent storage.

The dossier follows the manifesto exactly — CV, vision essay, contribution plan — but store
the **contribution plan as structured fields**, not only a PDF, because the probation review
has to check it later.

## Flow C — Review, probation, confirmation

```
pending → under_review → approved   → probationary member (6 months) → confirmed member
                       → needs_more_info → (back to pending)
                       → rejected
```

The six-month probation is the manifesto's own rule: admission is followed by a probation
period at the end of which the circle evaluates whether the member kept their initial
commitments. So:

- On approval: `role = member`, set `member_since` and `probation_until = now + 6 months`.
- At `probation_until`, `/review/probation` surfaces the member for a confirmation
  decision, showing the contribution plan they submitted alongside their name. A
  queue of names alone would invite a rubber stamp: the reviewer would have
  nothing to check them against.
- Confirmation or reversion is recorded in the audit log with a rationale.

**Built, with three rules worth stating.**

*The six months cannot be cut short.* `confirmProbation` refuses a decision taken
before `probation_until` has passed. A reviewer who could close a probation early
could admit someone outright in a single click, which is the thing the probation
period exists to prevent.

*Confirmation is its own timestamp.* `probation_confirmed_at` is a column, not
the absence of `probation_until`. Clearing the end date would erase when
probation ran and make a confirmed member indistinguishable from one who never
had a clock.

*Reversion returns the person to `reader`* and clears `member_since` and
`probation_until`, because those describe a membership that has ended. Their
approved application stays on file and does not block a fresh one — the partial
unique index only bars a second *open* application — so someone who did not keep
their commitments this time can apply again. The `role_change` row is what
preserves the history, and it is required to carry a written reason.

## Flow D — Promotion to senior member

Not self-serve, and **not one person's click**. The manifesto rejects simple majority for
consequential decisions; a promotion that grants access to every member's dossier is
exactly that kind of decision.

**Built** as `senior_promotion` plus `senior_promotion_vote`, decided at `/review/promotions`.
The rule is at least **three approvals** and at least **two thirds of the votes cast** —
`evaluate()` in `src/lib/promotion.ts`, kept pure so the arithmetic is tested on its own.
Four things are worth stating:

- **The denominator is votes cast, not the electorate.** A senior member who does not vote
  neither helps nor blocks. Counting silence as opposition would make a busy month into a
  veto.
- **Rejection waits for arithmetic, not for a deadline.** A nomination closes as rejected
  only once it would fail even if every remaining senior member approved. Earlier than that
  and we would be closing a vote against someone who could still have carried it.
- **Every vote carries a written reason and a name.** A secret ballot would protect the
  voters; naming them protects the person being voted on.
- **The `role_change` row has no actor.** The circle promoted them, not whoever voted last.
  It records the tally instead, and the individual votes remain the real account.

Only a **confirmed** member may be nominated. Someone still inside their six months has not
yet been measured against what they promised, and promoting them would skip the check the
probation exists for.

One consequence to know about: with fewer than three senior members a promotion cannot pass
at all. That is correct — it is why the first cohort forms by cooptation.

## Flow E — Invitation (cooptation)

Someone who arrives by recommendation should not have to argue their way in through the
public process. The manifesto already provides for this — *cooptation* — and it is how
the first cohort forms at all, since there is nobody to review the reviewers.

A senior member issues a signed, single-use invitation expiring in 7 days. What the
invitation changes, and what it deliberately does not:

**Skipped — the committee review.** The sponsor's judgement replaces it. The application
is created already approved, and the sponsoring member is recorded against it.

**Skipped — the CAPTCHA.** A valid invitation token is a stronger proof of humanity than
any challenge, since a senior member issued it by hand. Rate limiting still applies.

**Kept — email verification.** It is how the movement reaches the member, and it costs
one click.

**Kept — the contribution plan.** Not as a gate, but because the six-month probation
review checks the member against what they said they would do. Skipping it would leave
the probation review with nothing to evaluate. The CV and the vision essay may be
deferred; the plan may not.

**Kept — the probation period.** A sponsor vouches for someone; they do not certify them.
The manifesto's six months apply to every member by the same rule.

**Kept — the audit record.** `role_change` records the sponsor. If a sponsored member
later turns out to be a problem, the movement can see who vouched and when. The manifesto
commits KLE to *reddition de comptes*, and an invitation route with no trail is exactly
where that commitment would quietly fail.

So: fewer forms, the same standards, and one named person accountable for the judgement.

**Built.** A senior member issues an invitation at `/review/invitations`; the holder
registers at `/auth/register/invited?token=…`. What is worth knowing about it:

- **The database stores a SHA-256 of the token, never the token.** The raw value exists only
  in the emailed link and is shown to the sponsor once. Stored in the clear, a leaked backup
  would be a set of working membership grants, and anyone who could read the table could
  mint an account in someone else's name.
- **The email address comes from the invitation, not the form.** Taking it from the form
  would turn one invitation into an account under any address at all.
- **Spending it is a conditional update inside the transaction** that creates the account,
  so two people opening the same link at once cannot both end up with one. Checking first
  and writing after would leave precisely that window open.
- **The sponsor is shown the link as well as emailed it.** Delivery to a Haitian inbox is
  not something to take on faith, and an invitation nobody receives is one that quietly
  never happened.

The three dossier PDF columns became nullable for this flow alone — a sponsored member may
defer their CV and vision essay, never their contribution plan. `member_application.origin`
records which path an application came from, so a reviewer looking at a dossier with no CV
can see why.

## Flow F — Blocking and demotion

Senior members may block an account for misconduct. **Built** in `src/lib/moderation.ts`,
from `/review/members`.

`member_status` already existed in the schema and **nothing enforced it**: an account could
be marked blocked and carry on as before. It is enforced now, in three places, because one
of them is not enough:

- Blocking **deletes the person's sessions** in the same transaction as the status change.
  Otherwise they keep whatever access they had until their cookie happens to expire, which
  for misconduct serious enough to block is exactly the window that matters.
- **Sign-in refuses them** with a message that says they were blocked, rather than failing
  as a wrong password — which would have them reset it over and over.
- `requireUser` refuses a blocked account as a backstop.

Three rules in the decision itself. **Only downwards:** a senior member may act on readers
and members, and removing a senior member is a super admin's decision — one senior member
who could block their peers could neutralise the admission committee alone. **Never on your
own account.** And **blocking suspends, it does not demote**: the role is untouched, so
unblocking restores exactly what the person had.

Reversible, with a written reason, and the person is emailed the reason — a block nobody can
contest is not accountable, and the manifesto's answer to a bad decision is that it can be
seen and undone.

## Audit log (non-negotiable)

Append-only, never updated or deleted:

```
role_change       (id, subject_user_id, from_role, to_role, actor_id, rationale, created_at)
application_event (id, application_id, from_status, to_status, actor_id, rationale, created_at)
access_event      (id, actor_id, resource_type, resource_id, action, ip, created_at)
```

`access_event` must record **every dossier file download**. That is how an insider leak is
detected, and it is the only honest way to promise members that their CV is not being
passed around. The manifesto commits KLE to *transparence totale* and *reddition de
comptes*; this table is that commitment in code.
