# Security

## Threat model — read this first

This is not a normal blog, and treating it like one is the main risk.

**What we hold:** a list of politically engaged Haitians, with real names, email addresses,
CVs (employers, education, often addresses and phone numbers), essays stating their
political convictions, and their age.

**What a breach costs:** the manifesto names armed non-state actors, entrenched political
interests and a captured judiciary as the adversaries of the movement. A leaked member
roster is a targeting list. The realistic worst case is not embarrassment or a fine — it is
someone being harassed, losing their job, or being hurt.

**Therefore the primary security property of this system is the confidentiality of the
member roster and the application dossiers.** Availability and integrity matter, but if we
must trade, we trade in favour of confidentiality. Every decision below follows from that.

**Adversaries we design against:** opportunistic credential stuffing; targeted doxxing;
a politically motivated actor who specifically wants the member list; and — the one people
forget — a legitimate senior member account that has been compromised or turned.

## P0 — Before a single real user registers

1. ~~**Real transactional email.**~~ **DONE.** Resend is wired in via
   `src/lib/email/`. Verification mail is sent in the recipient's own language,
   resolved from the request scope. Without `RESEND_API_KEY` and `EMAIL_FROM`
   the mailer prints to the console in development and **refuses to start in
   production** — a silent no-op there would mean no account could ever be
   activated, and it would look like slow mail rather than absent mail.
   Delivery failures are raised rather than swallowed, because Better Auth
   reports signup as successful either way.
2. ~~**Rate limiting.**~~ **DONE, in two layers — and the second is the one that
   matters.** Better Auth's limiter and its captcha plugin both hook `onRequest`,
   so they only cover traffic arriving at `/api/auth/*`. Sign-in and sign-up run
   through server functions calling `auth.api.*` in-process and never touch that
   path, so those protections would never have fired for them. Better Auth's
   limiter is enabled with strict per-path rules for what it does cover;
   `guard()` in `auth-actions.ts` covers the rest, backed by the `auth_throttle`
   table. Per-IP everywhere, plus a per-email failure counter on sign-in —
   credential stuffing against one targeted member arrives from many addresses.
   Counters live in Postgres, not memory, so they survive a deploy and are
   shared across instances.

   **Corrected before launch (D32):** both limiters keyed on the *first* entry of
   `X-Forwarded-For` — the one entry the client writes, since proxies append to
   that header. Forging a new one per request earned a fresh bucket every time:
   unlimited password guessing, and forged addresses in the dossier access log.
   The address now comes only from `CLIENT_IP_HEADER`, a header the proxy sets;
   production will not start without it, or with `x-forwarded-for` as its value.
3. ~~**Bot defence on registration**~~ **DONE, on reader registration only.**
   Cloudflare Turnstile, verified server-side in `lib/auth/captcha.ts`. Chosen over
   reCAPTCHA because it does not profile the visitor: asking Haitians to pass
   through Google's tracking to prove they are human is the wrong trade for this
   movement. Verification **fails closed** — a Cloudflare outage blocks
   registration rather than opening it — and a missing secret is a startup
   failure in production.

   **Not on the member application, deliberately.** That form asks for three
   PDFs, two essays and a human review; the friction already filters automated
   abuse far better than a challenge does, and adding one would tax the most
   committed applicants for nothing. Volume abuse there is a rate-limiting
   problem, and it is rate-limited. Reader registration is different: it is
   cheap, auto-approved after email verification, and it grants forum access,
   so fake accounts are both easy to make and useful to an adversary.
4. ~~**Fix the orphaned-account bug** in `signUpMember`.~~ **DONE.** The three PDFs
   are validated and held in memory before the account exists, and if storing the
   application fails afterwards, `rollbackFailedApplication` deletes the account
   and its files so the applicant can simply try again. Not covered by an
   automated test (it needs a database failure mid-sign-up). One small leftover:
   the verification email is sent before the application is stored, so after a
   rollback the applicant may hold a link to an account that no longer exists;
   it fails harmlessly, and the page has already told them to try again.
5. ~~**Remove the mock Google path before launch.**~~ Done (D27). There is no social
   sign-in; an account is an email and a password, and nothing else authenticates.
6. ~~**Cookies and transport.**~~ **DONE (D32).** Production refuses to start unless
   `BETTER_AUTH_URL` is `https://`, which is what makes Better Auth mark the
   session cookie `secure` (with the `__Secure-` prefix); `httpOnly` and
   `sameSite=lax` are set explicitly. Every response carries HSTS (production,
   HTTPS), `X-Content-Type-Options`, `X-Frame-Options: DENY`,
   `Referrer-Policy: same-origin` and a `Permissions-Policy`. The `lang` cookie is
   deliberately readable and that is fine.
7. **Secrets:** `.env.local` and `uploads/` are correctly gitignored — keep it that
   way. The procedure for replacing `BETTER_AUTH_SECRET` is in `DEPLOYMENT.md`,
   step 8. What remains is operational: keeping the secret out of the repository
   and knowing who holds it.

## P1 — Protecting the roster and dossiers

8. **Dossiers leave local disk.** Every upload — dossiers and companion PDFs — goes
   under `UPLOAD_ROOT` (`lib/shared/upload-root.ts`; `./uploads` by default). For
   launch, a server with a persistent disk and the encrypted, off-server backups in
   `DEPLOYMENT.md` step 6 is acceptable. Later, move to S3-compatible object
   storage: private ACL, random UUID keys never derived from user input, access only
   through short-lived signed URLs minted for an authorised senior member. Until
   then, a host that wipes its disk on redeploy must not be used.
9. **Application-level encryption for the sensitive columns.** Provider disk encryption
   protects against a stolen drive; it does nothing against a leaked database dump, a SQL
   injection, or an over-broad backup. Envelope-encrypt the essays and dossier file keys
   with AES-256-GCM using a key held in a KMS, so the ciphertext in a dump is useless.
10. **Data minimisation** is a security control, not a formality:
    - Birth **year**, not full date of birth.
    - No national ID, ever.
    - **Allow a pseudonymous public byline.** A member's legal name is needed for the
      admission committee; it is not needed on the article. In Haiti this distinction can
      matter a great deal, and it costs us one column.
11. **Retention, enforced by a job, not by intention.** Rejected applications: files and
    essays purged after 90 days, keeping only the decision record. Approved members:
    dossiers retained while active, deleted 90 days after departure. Publish this policy in
    the registration UI so applicants know before they upload.

## P2 — Access control and accountability

12. **Authorise on the server, in every server function.** `requireRole()` in
    `src/lib/auth/session.ts` is correct, but route guards are UX — a `createServerFn` is a
    public HTTP endpoint and must re-check the caller's role itself, every time. This is
    the single most common way apps of this shape leak data.
13. **Mandatory TOTP 2FA for `senior_member` and `super_admin`**, optional for everyone
    else. Better Auth has a 2FA plugin with account lockout after repeated failures. These
    are the accounts that can read dossiers; this is the highest-value control on the list.
14. **Audit log** as specified in `phases/01-ENROLLMENT.md`, including every dossier
    download. Review it periodically — an audit log nobody reads is a log file.
15. **Session hygiene:** reasonable expiry, a visible list of active sessions, and a
    "sign out everywhere" control.
16. Consider Postgres Row-Level Security as defence in depth once the schema settles.

## P3 — Application security

17. **Sanitise all rich text server-side**, from the editor and from DOCX import alike.
    Storing ProseMirror JSON rather than HTML makes this structural: unknown nodes are
    dropped at parse time and script cannot survive the round trip.
18. ~~**CSP**~~ **DONE (D32).** `script-src 'self'` plus a per-request nonce plus
    Turnstile, no `unsafe-inline` for scripts; `frame-ancestors 'none'`,
    `object-src 'none'`, `base-uri 'self'`. The nonce reaches every inline script
    the server renders through the router's `ssr.nonce`; `e2e/csp.spec.ts` proves
    it against a production build and fails on every page when the nonce is
    removed. Styles allow `'unsafe-inline'` — the editor sets inline styles, and a
    style cannot run code.
19. ~~**Validate uploads by magic bytes, not `file.type`.**~~ **DONE.** `%PDF-` for
    PDFs (`stageApplicationPdf`, `preparePdf`), `PK\x03\x04` and the ZIP directory
    for DOCX; `file.type` is never trusted.
20. **Password policy:** raise `minPasswordLength` from 8 to 12, and check candidates
    against the HaveIBeenPwned k-anonymity range API — it never sends the password or its
    full hash, and it stops credential-stuffing at the source. Offer passkeys.
21. **CSRF:** Better Auth covers its own endpoints; verify origin on our server functions.
22. Optional but advisable: ClamAV scan on uploaded PDFs and DOCX files. Companion PDFs
    are the case where it matters most, because they are the one upload served to the
    public; `lib/articles/companion/pdf.ts` refuses active content but parses with a library that is no
    longer maintained (D26).

## P4 — Operations

23. **Backups are another copy of the roster.** Encrypt them, restrict who can restore
    them, and test a restore before launch.
24. **Confirm the host sets `x-forwarded-for` before launch.** Without a proxy
    header, `clientIp()` returns `unknown` and every caller shares a single
    rate-limit bucket — they throttle each other. It fails in the safe
    direction, but the site becomes unusable under real load.

    Related, and settled in code: **the per-IP sign-in limit is deliberately
    loose (30 per 15 minutes) and a successful sign-in clears it.** For this
    audience one IP is routinely one neighbourhood — a cybercafé, an office, a
    mobile carrier behind NAT — so a tight per-IP limit locks out everybody at
    once. Counting successful sign-ins against the budget made it worse: a
    household using the site normally could exhaust it between them. The
    defence against credential stuffing is `signInPerEmail`, which is keyed to
    the account actually under attack and is untouched by this.
25. **Choose the hosting jurisdiction deliberately.** A managed provider in the EU or US
    gives better availability and security engineering than self-hosting in Haiti, at the
    cost of placing member data under a foreign legal regime. There is no free answer —
    make it a recorded decision rather than a default.
25. **Least privilege in Postgres:** the application role cannot `DROP`; migrations run as
    a separate role.
26. **Write the incident response plan before the incident**, including how members get
    notified. For this user population, fast honest notification is a safety measure.

## Governance controls (phase 1, built)

**Blocking is enforced in three places**, because one is not enough: the sessions are
deleted with the status change, sign-in refuses the account by name, and `requireUser`
refuses it as a backstop. A status column that nothing checks is not a control — which is
what `member_status` was before this.

**Blocking only acts downwards.** A senior member may block readers and members; removing a
senior member is a super admin's decision. One senior member who could block their peers
could neutralise the admission committee alone, and the manifesto puts consequential
decisions in more than one pair of hands.

**Promotion to senior member is a qualified-majority vote** — three approvals and two thirds
of the votes cast, recorded voter by voter with a written reason. The role being granted is
read access to every applicant's CV and essays, which is the most sensitive thing the
system holds. No single account can grant it.

**Invitation tokens are stored as a SHA-256 hash.** The raw token exists only in the emailed
link. A leaked backup must not be a set of working membership grants. They are single-use,
expire in seven days, revocable, and spent by a conditional update inside the transaction
that creates the account, so the same link cannot produce two accounts.

**The public invitation lookup is rate-limited.** A 32-byte token is not guessable, so this
is not brute-force defence; it stops an unauthenticated endpoint being used as a free probe.

## Getting registration "top notch"

Concretely, that means: real verified email, 12-character minimum checked against breached
password lists, optional passkeys, mandatory 2FA for anyone who can read a dossier,
rate limiting plus a CAPTCHA on the registration endpoint, disposable-email domains
rejected for member applications, birth year instead of full DOB, a published retention
policy, and an audit trail on every privileged read.
