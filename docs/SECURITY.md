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

1. **Real transactional email.** `src/lib/auth.ts` currently `console.log`s the verification
   link. Until a real provider is wired in, email verification is decorative and anyone can
   register any address.
2. **Rate limiting.** Better Auth ships rate limiting; enable it and add stricter custom
   rules on sign-in, sign-up, verification and password reset. Add per-IP limits on uploads.
3. **Bot defence on registration** — Turnstile or hCaptcha, both privacy-respecting.
4. **Fix the orphaned-account bug** in `signUpMember` (see `phases/02-ENROLLMENT.md`).
5. **Remove the mock Google path before launch.** `mockGoogleSignIn` returning
   `NOT_IMPLEMENTED` is safe today; a half-finished OAuth path shipped to production is not.
6. **Cookies and transport:** HTTPS only, HSTS, session cookie `httpOnly` + `secure` +
   `sameSite=lax`. The `lang` cookie is deliberately readable and that is fine.
7. **Secrets:** `.env.local` and `uploads/` are correctly gitignored today — keep it that
   way. Plan for `BETTER_AUTH_SECRET` rotation; treat it as a break-glass procedure.

## P1 — Protecting the roster and dossiers

8. **Dossiers leave local disk.** `src/lib/uploads.ts` writes to `./uploads`, outside the
   webroot with no serving route — the right default, but it will not survive a redeploy on
   cloud hosting. Move to S3-compatible object storage, private ACL, random UUID keys never
   derived from user input, access only through short-lived signed URLs minted for an
   authorised senior member.
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
    `src/lib/session.ts` is correct, but route guards are UX — a `createServerFn` is a
    public HTTP endpoint and must re-check the caller's role itself, every time. This is
    the single most common way apps of this shape leak data.
13. **Mandatory TOTP 2FA for `senior_member` and `super_admin`**, optional for everyone
    else. Better Auth has a 2FA plugin with account lockout after repeated failures. These
    are the accounts that can read dossiers; this is the highest-value control on the list.
14. **Audit log** as specified in `phases/02-ENROLLMENT.md`, including every dossier
    download. Review it periodically — an audit log nobody reads is a log file.
15. **Session hygiene:** reasonable expiry, a visible list of active sessions, and a
    "sign out everywhere" control.
16. Consider Postgres Row-Level Security as defence in depth once the schema settles.

## P3 — Application security

17. **Sanitise all rich text server-side**, from the editor and from DOCX import alike.
    Storing ProseMirror JSON rather than HTML makes this structural: unknown nodes are
    dropped at parse time and script cannot survive the round trip.
18. **CSP** with `script-src 'self'` and no `unsafe-inline`, plus `frame-ancestors 'none'`,
    `X-Content-Type-Options: nosniff`, and a strict `Referrer-Policy`.
19. **Validate uploads by magic bytes, not `file.type`.** `assertPdf()` currently trusts
    `file.type`, which is supplied by the client and trivially spoofed. Check the leading
    bytes (`%PDF-` for PDF, `PK\x03\x04` for DOCX).
20. **Password policy:** raise `minPasswordLength` from 8 to 12, and check candidates
    against the HaveIBeenPwned k-anonymity range API — it never sends the password or its
    full hash, and it stops credential-stuffing at the source. Offer passkeys.
21. **CSRF:** Better Auth covers its own endpoints; verify origin on our server functions.
22. Optional but advisable: ClamAV scan on uploaded PDFs and DOCX files.

## P4 — Operations

23. **Backups are another copy of the roster.** Encrypt them, restrict who can restore
    them, and test a restore before launch.
24. **Choose the hosting jurisdiction deliberately.** A managed provider in the EU or US
    gives better availability and security engineering than self-hosting in Haiti, at the
    cost of placing member data under a foreign legal regime. There is no free answer —
    make it a recorded decision rather than a default.
25. **Least privilege in Postgres:** the application role cannot `DROP`; migrations run as
    a separate role.
26. **Write the incident response plan before the incident**, including how members get
    notified. For this user population, fast honest notification is a safety measure.

## Getting registration "top notch"

Concretely, that means: real verified email, 12-character minimum checked against breached
password lists, optional passkeys, mandatory 2FA for anyone who can read a dossier,
rate limiting plus a CAPTCHA on the registration endpoint, disposable-email domains
rejected for member applications, birth year instead of full DOB, a published retention
policy, and an audit trail on every privileged read.
