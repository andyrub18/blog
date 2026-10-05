# Deploying KLEA

For whoever puts the platform on a server. Read `SECURITY.md` first: this
database holds names, emails, CVs and political essays from people organising
in Haiti, and every choice below leans towards keeping them.

The setup is a single **Ubuntu 24.04 VPS** (KLEA uses OVHcloud), with the app,
PostgreSQL and Caddy on it, and encrypted backups copied to a *different*
provider. Three scripts in `deploy/` do the work:

| Script | Run | Does |
|---|---|---|
| `setup-server.sh` | once | Packages, firewall, SSH, PostgreSQL, the `klea` user, the services |
| `klea-deploy` | every release | Builds a new release, migrates, switches, checks — and switches back if the new one does not answer |
| `klea-backup` | nightly, by a timer | Encrypts the database and uploads, copies them off the server |

No Docker, on purpose: D33 in `DECISIONS.md` says why.

The server **refuses to start** if a production setting that protects members is
missing or unsafe — no Resend key, no Turnstile secret, an `http://` address, no
client address header. That is deliberate. Fix the setting; never set
`ALLOW_INSECURE_LOCAL` on a server.

---

## 1. Order the server and the domain

**The domain**, at Cloudflare Registrar, under a `.org` or `.com`. Register it
in the name of an organisation or a trusted person outside Haiti, not a member
living there: registries hold the registrant's identity even when public
lookups hide it. Turn on two-factor authentication — whoever controls the DNS
can impersonate the site and read every verification email.

**The VPS**, at OVHcloud. When ordering:

- **Location:** Beauharnois (Canada) is the closest to Haiti, French-speaking,
  under Canadian privacy law; Gravelines or Strasbourg (France) put it in the
  EU. Not the United States, and never Haiti.
- **Image:** Ubuntu 24.04.
- **Size:** 2 GB of memory works (the setup adds swap, because the build needs
  nearly 2 GB); 4 GB or more is comfortable. 40 GB of disk or more.
- **SSH key:** add your public key in the order form. Without one OVH emails a
  password, and the setup leaves password login on until a key is installed.
- **A server for KLEA alone.** Do not put other projects on it: anything else
  running there is another way in to the dossiers.

**DNS**, in Cloudflare: an `A` record for the domain pointing to the VPS's IPv4
address, and an `AAAA` record to its IPv6 address. Then choose:

- **DNS only (grey cloud)** — visitors connect straight to the server. Simplest.
- **Proxied (orange cloud)** — visitors connect to Cloudflare, which forwards to
  the server. Protects against floods of traffic meant to take the site down,
  but Cloudflare decrypts what passes through. KLEA's call; see the discussion
  in the PR that introduced this file. If proxied, set Cloudflare's
  **SSL/TLS mode to "Full (strict)"**.

## 2. Set up the server

Sign in (`ssh ubuntu@<the server's address>`), then:

```bash
curl -fsSLO https://raw.githubusercontent.com/andyrub18/blog/main/deploy/setup-server.sh
less setup-server.sh                 # read what you are about to run as root
sudo DOMAIN=your-domain bash setup-server.sh
# or, behind Cloudflare's proxy:
sudo DOMAIN=your-domain CLOUDFLARE_PROXY=1 bash setup-server.sh
```

Nothing needs installing beforehand. It installs Node 24, PostgreSQL 16, Caddy,
`age` and `rclone`; turns on automatic security updates (with a reboot at 04:30
UTC when one needs it); opens only SSH, 80 and 443 in the firewall — and only to
Cloudflare's addresses when proxied; turns off SSH password login once it has
checked your key works; creates the `klea` user, the database with a generated
password, and `/etc/klea/env` with a generated auth secret. Running it again is
safe.

## 3. Fill in the settings

```bash
sudo nano /etc/klea/env
```

Four values are marked **FILL IN**:

| Setting | Where it comes from |
|---|---|
| `RESEND_API_KEY` | Resend → API keys. First verify the domain in Resend (it gives you DNS records to add in Cloudflare — SPF, DKIM, DMARC). Until it is verified, Resend only mails the account owner and nobody else can confirm an address. |
| `EMAIL_FROM` | Already filled in as `KLEA <noreply@your-domain>`; change it if you like, on the verified domain. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile → add a site for the domain. |

Everything else was generated. The file is readable only by root and the app.

## 4. Behind Cloudflare's proxy only: the origin certificate

In Cloudflare: SSL/TLS → Origin Server → Create certificate. Save the
certificate as `/etc/caddy/cloudflare-origin.pem` and the private key as
`/etc/caddy/cloudflare-origin.key`, then:

```bash
sudo chown root:caddy /etc/caddy/cloudflare-origin.*
sudo chmod 640 /etc/caddy/cloudflare-origin.*
sudo systemctl reload caddy
```

Without the proxy, skip this: Caddy obtains a certificate by itself as soon as
the DNS record points at the server.

## 5. Deploy

```bash
sudo klea-deploy
```

Checks the settings first, then builds the latest `main` in a new release
directory, applies database migrations, switches to it, and checks that it
answers — directly and through Caddy, with its security headers. If the new
release does not answer, it switches back to the previous one, deletes the one
that failed, and says so; a build that fails never touches the site at all. The
first deploy takes a few minutes (it downloads every package); later ones
reuse that download and take about a minute and a half.

The same command deploys every later version. To go back to an earlier one,
`sudo klea-deploy <commit>`. Rolling back code does not roll back the database:
migrations only move forward, so going back across one that removed something
needs thought first.

## 6. The first administrator

```bash
sudo klea-create-admin
```

Asks for an email, a name and a password at a prompt (so the password stays out
of the shell history). At least 12 characters: this account can read every
dossier.

## 7. Backups — encrypted, off the server, and tested

Back up **both** the database and the uploads: a database without its files has
applications whose CVs are gone. Every night `klea-backup` encrypts both with
[`age`](https://age-encryption.org), to a key whose private half is **not on the
server**, and copies them to another provider. A server that is broken into
cannot read its own backups, and neither can whoever stores them.

**Once, on your own computer — not the server:**

```bash
age-keygen -o klea-backup.key     # prints "Public key: age1…"
```

Keep `klea-backup.key` offline, in two places, known to two people. Lose it and
the backups are unreadable; leak it and they are readable.

**On the server:**

```bash
sudo rclone config                # add the other provider, e.g. Backblaze B2, named "b2"
sudo nano /etc/klea/backup.env    # BACKUP_AGE_RECIPIENT=age1…   BACKUP_REMOTE=b2:klea-backups
sudo klea-backup                  # run one now, and check it reached the other side
```

Until both are filled in, the nightly backup **fails on purpose**, so it shows in
`systemctl --failed` rather than being discovered missing on the day it is
needed. `systemctl list-timers klea-backup` says when it last ran.

**Restore, to prove it works** — before launch, then every few months, on a
computer that is not the server:

```bash
age --decrypt -i klea-backup.key klea-db-….dump.age > klea.dump
createdb klea_restore && pg_restore --no-owner -d klea_restore klea.dump
age --decrypt -i klea-backup.key klea-uploads-….tar.age | tar -t | head
```

A backup nobody has restored is a hope, not a backup.

## 8. After each deploy

`klea-deploy` checks the first two itself; do the rest by hand the first time,
and after anything touching sign-in or scripts.

1. `curl -sI https://your-domain/fr/` shows `strict-transport-security`,
   `content-security-policy` with a `nonce-`, and `x-frame-options: DENY`.
2. Register a reader with an address you can read. The email arrives, from the
   verified domain, not in spam; its link signs you in, in the language you
   registered in.
3. Sign in as the administrator; open the review queue.
4. Open an article, its version history, its discussion, and click something on
   each — a page that renders but does not respond is a Content-Security-Policy
   problem (`e2e/csp.spec.ts` checks this against a production build).

## 9. Keeping it up to date

- **Ubuntu security updates** install themselves nightly.
- **Node and Caddy** come from their own repositories: once a month,
  `sudo apt update && sudo apt upgrade`, then `sudo systemctl restart klea caddy`.
- **Behind Cloudflare's proxy**, its address list changes rarely; when it does,
  run `setup-server.sh` again with the same options to refresh the firewall and
  Caddy.
- `journalctl -u klea -f` shows the app's log; `systemctl status klea caddy postgresql`
  their state. There is no access log, on purpose: a file of which address read
  which article is the record `SECURITY.md` says not to keep.

## 10. Replacing `BETTER_AUTH_SECRET`

Do it if it may have leaked — a copied settings file, a departed administrator,
a compromised machine. Replacing it **signs everybody out** and invalidates any
verification link not yet clicked; that is the point.

1. `openssl rand -base64 32` for a new one.
2. Put it in `/etc/klea/env` in place of the old one.
3. `sudo systemctl restart klea`.
4. Tell members they will need to sign in again, and that anyone waiting on a
   verification email can ask for a new one from the sign-in page.

Keep a record of when and why — the same accountability the audit log gives the
rest of the platform.

---

## Reference: why the proxy sets `X-Real-IP`

Every rate limit that protects members' accounts — sign-in, registration,
resending verification mail — counts requests per client address, and the
dossier access log records it. The app reads the address from the one header
named by `CLIENT_IP_HEADER`, which must be a header the proxy **overwrites** on
every request. `X-Forwarded-For` does not qualify: proxies *append* to it, so
its first entry is whatever the client wrote, and a client that writes a new one
each time gets unlimited password guesses (D32). The server refuses to start
with it.

`deploy/Caddyfile.direct` sets `X-Real-IP` to the address the visitor connected
from. `deploy/Caddyfile.cloudflare` believes Cloudflare's `CF-Connecting-IP` only
when the connection comes from Cloudflare's own addresses, and sets `X-Real-IP`
from that; the firewall lets nobody else reach ports 80 and 443 anyway. Either
way the app's setting is the same: `CLIENT_IP_HEADER=x-real-ip`.

## Reference: where things are

| Path | What |
|---|---|
| `/srv/klea/repo` | A clone of the repository, fetched by each deploy |
| `/srv/klea/releases/<time>-<commit>` | One directory per release; the last three are kept |
| `/srv/klea/current` | The release being served (a symlink) |
| `/var/lib/klea/uploads` | Dossiers and companion PDFs — app and root only |
| `/etc/klea/env` | Production settings — root and the app only |
| `/etc/klea/backup.env` | Backup key and destination — root only |
| `/var/backups/klea` | The last few nights' encrypted backups |
| `/etc/caddy/Caddyfile` | Written by `setup-server.sh` from `deploy/Caddyfile.*` |
