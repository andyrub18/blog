# Phase 2 — Enrollment and promotion

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

One schema fix: `member_application.userId` is currently `UNIQUE`, which permanently blocks
anyone who is rejected once. Replace it with a partial unique index so a user may have only
one **open** application but a full history:

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
- At `probation_until`, the application queue surfaces the member for a confirmation
  decision, checked against the contribution plan they submitted.
- Confirmation or reversion is recorded in the audit log with a rationale.

## Flow D — Promotion to senior member

Not self-serve, and **not one person's click**. The manifesto rejects simple majority for
consequential decisions; a promotion that grants access to every member's dossier is
exactly that kind of decision. Require a qualified majority of existing senior members
(suggested: at least three approvals and at least two-thirds of those who vote), recorded
individually.

## Flow E — Invitation (cooptation)

A senior member may invite someone directly with a signed, single-use, expiring token
(7 days). The invitee still verifies their email; the invitation replaces the dossier
review, and the inviting member is recorded as the sponsor. This is how the movement
bootstraps its first cohort without everyone filing paperwork.

## Flow F — Blocking and demotion

Senior members may block an account for misconduct. Blocking must be reversible, require a
written rationale, and notify the person. Any role change — up or down — writes to the
audit log.

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
