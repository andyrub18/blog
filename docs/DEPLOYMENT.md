# Deploying KLEA

For whoever puts the platform on a server. Read `SECURITY.md` first: this
database holds names, emails, CVs and political essays from people organising
in Haiti, and every choice below leans towards keeping them.

The server **refuses to start** if a production setting that protects members is
missing or unsafe — no Resend key, no Turnstile secret, an `http://` address, no
client address header. That is deliberate. Fix the setting; do not reach for
`ALLOW_INSECURE_LOCAL`, which exists for a developer running a production build
on their own machine and must **never** be set on a server.

## 1. Before you start

| You need | Why |
|---|---|
| A domain, served over **HTTPS** | Session cookies are only marked secure over HTTPS, and the server will not start otherwise. |
| **PostgreSQL 16+** | Reachable only from the app server. If it is on another machine, connect with TLS (`?sslmode=require`). |
| A **persistent disk** for uploads | Dossiers and companion PDFs are files on disk (`UPLOAD_ROOT`). A host whose disk is wiped on redeploy loses every applicant's CV. |
| A **reverse proxy** in front of the app | Terminates TLS and tells the app who the client is (step 4). Caddy is the simplest; nginx works. |
| A **Resend** account, with **your domain verified** | Without SPF, DKIM and DMARC records Resend only mails the account owner, so nobody else can verify an address. |
| A **Cloudflare Turnstile** site | The captcha on reader registration. |
| Node **24** | What the platform is built and tested with. |

## 2. Settings

Set these in the service's environment (step 5), not in a file in the
repository. `.env.example` documents each one.

| Variable | Production value |
|---|---|
| `DATABASE_URL` | `postgres://klea:…@db-host:5432/klea?sslmode=require` — a dedicated role that owns the `klea` database, not the `postgres` superuser. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`. Signs every session. Store it like a password; see step 8 to replace it. |
| `BETTER_AUTH_URL` | `https://your-domain` — **must** be `https://`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | From Resend. `EMAIL_FROM` must be an address on the verified domain, e.g. `KLEA <noreply@your-domain>`. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | From Cloudflare. |
| `CLIENT_IP_HEADER` | The header your proxy **sets**: `x-real-ip`, or `cf-connecting-ip` behind Cloudflare. **Never** `x-forwarded-for` — the server refuses it (step 4 says why). |
| `UPLOAD_ROOT` | A directory on the persistent disk, e.g. `/var/lib/klea/uploads`. |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_NAME` | Only for the one-time `db:seed` in step 3; remove them afterwards. |
| `PORT` | The port the app listens on behind the proxy, e.g. `3000`. |
| `NODE_ENV` | `production`. |

**Never set** `ALLOW_INSECURE_LOCAL`.

## 3. Build, migrate, seed

On the server, as the user the app will run as, from a checkout of `main`:

```bash
npm ci                      # dev dependencies too: migrations and the seed need them
npm run build
npx drizzle-kit migrate     # with DATABASE_URL in the environment
npx tsx scripts/seed-super-admin.ts   # once, with the SUPER_ADMIN_* variables set
```

**Never run `db:seed:demo` on a server.** It creates demo accounts with a
published password; it refuses to run in production for that reason.

Create the upload directory, owned by the app user and readable by nobody else:

```bash
sudo install -d -o klea -g klea -m 700 /var/lib/klea/uploads
```

## 4. The reverse proxy

The proxy does two jobs: TLS, and telling the app the client's real address.

**Why the second matters.** Every rate limit that protects members' accounts —
sign-in, registration, resending verification mail — counts requests per client
address, and the dossier access log records it. The app reads the address from
the one header named by `CLIENT_IP_HEADER`, and that header must be one the
proxy **overwrites** on every request. `X-Forwarded-For` does not qualify: proxies
*append* to it, so its first entry is whatever the client wrote, and a client
that writes a new one each time gets unlimited password guesses. That is why the
server will not start with it.

**Caddy** (TLS certificates automatic):

```caddy
your-domain {
	reverse_proxy localhost:3000 {
		header_up X-Real-IP {remote_host}
	}
}
```

**nginx:**

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;   # overwrites whatever the client sent
    proxy_set_header X-Forwarded-Proto https;
    client_max_body_size 25m;                  # companion PDFs go up to 20 MB
}
```

With `CLIENT_IP_HEADER=x-real-ip` for either. **Behind Cloudflare**, use
`cf-connecting-ip` instead, and make the origin accept connections from
Cloudflare's addresses only — otherwise anyone can reach the origin directly
and write the header themselves.

The app sends its own security headers (HSTS, a Content-Security-Policy with a
per-request nonce, `X-Frame-Options`, `Referrer-Policy: same-origin`); the proxy
does not need to add them. Do not have it add a second, different CSP.

## 5. Run it as a service

A systemd unit, `/etc/systemd/system/klea.service`:

```ini
[Unit]
Description=KLEA platform
After=network.target

[Service]
User=klea
WorkingDirectory=/srv/klea
EnvironmentFile=/etc/klea/env          # mode 600, owned by root
ExecStart=/usr/bin/node .output/server/index.mjs
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/klea/uploads
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`systemctl enable --now klea`, then `journalctl -u klea -f`. If a setting is
missing the service stops at once with the reason in the log — that is the
startup guard doing its job.

## 6. Backups — encrypted, off the server, and tested

Back up **both** the database and the upload directory: a database without its
files has applications whose CVs are gone. Encrypt before the backup leaves the
server, with a key that does not live on it — a backup is a copy of every
dossier, and an unencrypted one on a storage bucket is the leak `SECURITY.md`
exists to prevent. [`age`](https://age-encryption.org) is simple:

```bash
# once, on a machine that is NOT the server; keep klea-backup.key offline
age-keygen -o klea-backup.key          # prints the public key: age1…

# nightly, on the server (cron or a systemd timer)
pg_dump --format=custom "$DATABASE_URL" | age -r age1… > /backups/klea-$(date +%F).dump.age
tar -C /var/lib/klea -cf - uploads      | age -r age1… > /backups/klea-uploads-$(date +%F).tar.age
# then copy /backups off the server, and delete local copies older than a few days
```

The server only ever holds the public key, so a compromised server cannot read
old backups.

**Test a restore** before launch and every few months: decrypt a dump on another
machine, `pg_restore` it into an empty database, point a local build at it, and
open a dossier. A backup nobody has restored is a hope, not a backup.

## 7. After each deploy

1. `curl -sI https://your-domain/fr/` shows `strict-transport-security`,
   `content-security-policy` with a `nonce-`, and `x-frame-options: DENY`.
2. Register a reader with a real address you can read. The verification email
   arrives, from the verified domain, not in spam; its link signs you in and
   lands in the language you registered in.
3. Sign in as the super admin; open the review queue.
4. Open an article, its version history, its discussion. Click something on each
   — a page that renders but does not respond is a Content-Security-Policy
   problem (`e2e/csp.spec.ts` checks this against a production build).

## 8. Replacing `BETTER_AUTH_SECRET`

Do it if it may have leaked — a copied config file, a departed administrator,
a compromised machine. Replacing it **signs everybody out** and invalidates any
verification link not yet clicked; that is the point.

1. Generate a new one: `openssl rand -base64 32`.
2. Put it in the service's environment, replacing the old one.
3. `systemctl restart klea`.
4. Tell members they will need to sign in again, and that anyone waiting on a
   verification email can ask for a new one from the sign-in page.

Keep a record of when and why — the same accountability the audit log gives the
rest of the platform.
