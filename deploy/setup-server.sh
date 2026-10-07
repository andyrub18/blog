#!/usr/bin/env bash
#
# Prepare a fresh Ubuntu 24.04 server for KLEA. Run once, as root:
#
#   curl -fsSLO https://raw.githubusercontent.com/andyrub18/blog/main/deploy/setup-server.sh
#   sudo DOMAIN=your-domain bash setup-server.sh
#
# Options, as environment variables:
#   DOMAIN            required — the site's domain, e.g. kleayiti.org
#   CLOUDFLARE_PROXY  1 if visitors reach the server through Cloudflare's proxy
#                     (orange cloud); 0, the default, if they connect directly
#   REPO_URL, BRANCH  where the code comes from (default: this repository, main)
#
# Safe to run again: every step checks before it changes anything, and secrets
# already generated are never replaced. See docs/DEPLOYMENT.md for the whole
# procedure, and for what to do after this script.

set -Eeuo pipefail

DOMAIN="${DOMAIN:-}"
CLOUDFLARE_PROXY="${CLOUDFLARE_PROXY:-0}"
REPO_URL="${REPO_URL:-https://github.com/andyrub18/blog.git}"
BRANCH="${BRANCH:-main}"

APP_HOME=/srv/klea
UPLOADS=/var/lib/klea/uploads
BACKUPS=/var/backups/klea
ETC=/etc/klea

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31mxx %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die 'Run as root: sudo DOMAIN=your-domain bash setup-server.sh'
[[ -n $DOMAIN ]] || die 'Set DOMAIN, e.g.: sudo DOMAIN=kleayiti.org bash setup-server.sh'
[[ $DOMAIN =~ ^[a-z0-9.-]+$ ]] || die "DOMAIN looks wrong: $DOMAIN"
[[ $CLOUDFLARE_PROXY == 0 || $CLOUDFLARE_PROXY == 1 ]] || die 'CLOUDFLARE_PROXY must be 0 or 1'
# shellcheck source=/dev/null
. /etc/os-release
[[ ${ID:-} == ubuntu && ${VERSION_ID:-} == 24.04 ]] ||
  die "This script is written for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}."

export DEBIAN_FRONTEND=noninteractive
APT=(apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

# ---------------------------------------------------------------------------
say 'System packages'
"${APT[@]}" update
"${APT[@]}" upgrade
"${APT[@]}" install ca-certificates curl gnupg git openssl ufw unattended-upgrades \
  postgresql age rclone

install -d -m 755 /etc/apt/keyrings

# Node 24, from NodeSource: the version the platform is built and tested with.
if [[ ! -f /etc/apt/sources.list.d/nodesource.list ]]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' \
    >/etc/apt/sources.list.d/nodesource.list
fi
# Caddy, from its own repository: HTTPS certificates without any setup.
if [[ ! -f /etc/apt/sources.list.d/caddy-stable.list ]]; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    gpg --dearmor --yes -o /etc/apt/keyrings/caddy-stable.gpg
  echo 'deb [signed-by=/etc/apt/keyrings/caddy-stable.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main' \
    >/etc/apt/sources.list.d/caddy-stable.list
fi
"${APT[@]}" update
"${APT[@]}" install nodejs caddy
node_major=$(node -p 'process.versions.node.split(".")[0]')
[[ $node_major == 24 ]] || die "Expected Node 24, got $(node --version)"

# ---------------------------------------------------------------------------
say 'Automatic security updates'
# Ubuntu's security updates install every night, and the server reboots at 04:30
# UTC when one needs it — a kernel fix that waits for somebody to remember it
# is a kernel fix that does not happen. Node and Caddy come from their own
# repositories and are updated by `apt upgrade` (docs/DEPLOYMENT.md, step 9).
cat >/etc/apt/apt.conf.d/52klea-unattended <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF

# ---------------------------------------------------------------------------
say 'Memory'
# The build peaks near 2 GB. On a small plan without swap it would be killed
# halfway through a deploy.
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [[ $mem_kb -lt 4000000 && -z $(swapon --show --noheadings) ]]; then
  size=2G
  [[ $mem_kb -lt 3000000 ]] && size=4G
  fallocate -l "$size" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo "Added $size of swap."
else
  echo 'Enough memory, or swap already present.'
fi

# ---------------------------------------------------------------------------
say 'The klea user and its directories'
# The app runs as its own user, with no shell and no login: it owns its code
# and its uploads, and nothing else on the machine.
id klea &>/dev/null ||
  useradd --system --home-dir "$APP_HOME" --create-home --shell /usr/sbin/nologin klea
install -d -o klea -g klea -m 750 "$APP_HOME" "$APP_HOME/releases"
install -d -m 755 /var/lib/klea
# Applicants' CVs and essays: readable by the app and by root, nobody else.
install -d -o klea -g klea -m 700 "$UPLOADS"
install -d -o root -g root -m 700 "$BACKUPS"
install -d -o root -g klea -m 750 "$ETC"

# ---------------------------------------------------------------------------
say 'PostgreSQL'
# Listens on this machine only (Ubuntu's default), so the database is never
# reachable from the internet.
systemctl enable --now postgresql
psql_as_postgres() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qtA "$@"; }
if [[ ! -f $ETC/env ]]; then
  db_password=$(openssl rand -hex 24)
  if [[ $(psql_as_postgres -c "select 1 from pg_roles where rolname = 'klea'") == 1 ]]; then
    psql_as_postgres -c "alter role klea with login password '$db_password'"
  else
    psql_as_postgres -c "create role klea with login password '$db_password'"
  fi
else
  db_password=''
fi
[[ $(psql_as_postgres -c "select 1 from pg_database where datname = 'klea'") == 1 ]] ||
  psql_as_postgres -c 'create database klea owner klea'

# ---------------------------------------------------------------------------
say 'Settings'
if [[ ! -f $ETC/env ]]; then
  auth_secret=$(openssl rand -base64 32 | tr -d '\n')
  umask 027
  cat >"$ETC/env" <<EOF
# KLEA production settings — read by klea.service and klea-deploy.
# Generated by setup-server.sh. Fill in the four values marked FILL IN, then
# run: sudo klea-deploy        (docs/DEPLOYMENT.md, steps 3 and 5)

NODE_ENV=production
# The app listens on this machine only; Caddy is what the internet talks to.
HOST=127.0.0.1
PORT=3000

DATABASE_URL=postgres://klea:$db_password@127.0.0.1:5432/klea
# Signs every session. To replace it, see docs/DEPLOYMENT.md step 10.
BETTER_AUTH_SECRET=$auth_secret
BETTER_AUTH_URL=https://$DOMAIN
# Caddy sets this header to the visitor's real address (deploy/Caddyfile.*).
CLIENT_IP_HEADER=x-real-ip
UPLOAD_ROOT=$UPLOADS

# FILL IN: from Resend (resend.com), once $DOMAIN is verified there.
RESEND_API_KEY=
EMAIL_FROM="KLEA <noreply@$DOMAIN>"

# FILL IN: from Cloudflare Turnstile, for $DOMAIN.
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
EOF
  umask 022
  chown root:klea "$ETC/env"
  chmod 640 "$ETC/env"
  echo "Wrote $ETC/env with a new database password and auth secret."
else
  echo "$ETC/env already exists; left as it is."
fi

if [[ ! -f $ETC/backup.env ]]; then
  umask 077
  cat >"$ETC/backup.env" <<'EOF'
# Nightly encrypted backups — read by klea-backup (docs/DEPLOYMENT.md, step 7).

# FILL IN: the PUBLIC key printed by `age-keygen`, run on a computer that is NOT
# this server. Its private half never comes here: a stolen server must not be
# able to read its own backups.
BACKUP_AGE_RECIPIENT=

# FILL IN: an rclone remote and folder at another provider, set up with
# `sudo rclone config` — for example b2:klea-backups.
BACKUP_REMOTE=

BACKUP_KEEP_LOCAL_DAYS=7
BACKUP_KEEP_REMOTE_DAYS=90
EOF
  umask 022
  chmod 600 "$ETC/backup.env"
  echo "Wrote $ETC/backup.env."
fi

printf 'REPO_URL=%q\nBRANCH=%q\nDOMAIN=%q\nCLOUDFLARE_PROXY=%q\n' \
  "$REPO_URL" "$BRANCH" "$DOMAIN" "$CLOUDFLARE_PROXY" >"$ETC/deploy.env"
chmod 644 "$ETC/deploy.env"

# ---------------------------------------------------------------------------
say 'The code'
if [[ ! -d $APP_HOME/repo/.git ]]; then
  runuser -u klea -- git clone --branch "$BRANCH" "$REPO_URL" "$APP_HOME/repo"
else
  # A fetch alone would leave the checkout where the first run put it, and the
  # scripts and units below would put that old version back over the newer one
  # each deploy has installed since.
  runuser -u klea -- git -C "$APP_HOME/repo" fetch --prune origin
  runuser -u klea -- git -C "$APP_HOME/repo" checkout -q -B "$BRANCH" "origin/$BRANCH"
fi
src="$APP_HOME/repo/deploy"

# Scripts are replaced by renaming a new file over the old one, so a script that
# is running keeps reading the version it started with.
place() { # place <mode> <source> <destination>
  local tmp
  tmp=$(mktemp "$3.XXXXXX")
  install -m "$1" "$2" "$tmp"
  mv -f "$tmp" "$3"
}
place 755 "$src/deploy.sh" /usr/local/sbin/klea-deploy
place 755 "$src/backup.sh" /usr/local/sbin/klea-backup
place 755 "$src/create-admin.sh" /usr/local/sbin/klea-create-admin
place 644 "$src/klea.service" /etc/systemd/system/klea.service
place 644 "$src/klea-backup.service" /etc/systemd/system/klea-backup.service
place 644 "$src/klea-backup.timer" /etc/systemd/system/klea-backup.timer
systemctl daemon-reload
systemctl enable klea.service
# Fails every night until backup.env is filled in, on purpose: a missing backup
# should show up in `systemctl --failed`, not be discovered on the day it is needed.
systemctl enable --now klea-backup.timer

# ---------------------------------------------------------------------------
say 'Caddy'
if [[ $CLOUDFLARE_PROXY == 1 ]]; then
  ranges=$(curl -fsSL https://www.cloudflare.com/ips-v4; echo; curl -fsSL https://www.cloudflare.com/ips-v6)
  ranges=$(echo "$ranges" | grep -E '^[0-9a-f.:]+/[0-9]+$' | tr '\n' ' ')
  [[ -n $ranges ]] || die "Could not fetch Cloudflare's address ranges."
  sed -e "s|__DOMAIN__|$DOMAIN|" -e "s|__CLOUDFLARE_RANGES__|$ranges|" \
    "$src/Caddyfile.cloudflare" >/etc/caddy/Caddyfile
else
  sed -e "s|__DOMAIN__|$DOMAIN|" "$src/Caddyfile.direct" >/etc/caddy/Caddyfile
fi
if [[ $CLOUDFLARE_PROXY == 1 && ! -f /etc/caddy/cloudflare-origin.pem ]]; then
  warn 'Caddy is not reloaded yet: put the Cloudflare Origin certificate in'
  warn '/etc/caddy/cloudflare-origin.pem and its key in /etc/caddy/cloudflare-origin.key,'
  warn 'then run: sudo systemctl reload caddy   (docs/DEPLOYMENT.md, step 4)'
else
  out=$(caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1) ||
    die "Caddy rejected /etc/caddy/Caddyfile:
$out"
  systemctl enable caddy
  systemctl reload-or-restart caddy
fi

# ---------------------------------------------------------------------------
say 'Firewall'
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit OpenSSH >/dev/null
if [[ $CLOUDFLARE_PROXY == 1 ]]; then
  # Only Cloudflare reaches the web ports. Anyone else could otherwise skip it —
  # and its protection — by connecting to this server's address directly.
  ufw delete allow 80/tcp &>/dev/null || true
  ufw delete allow 443/tcp &>/dev/null || true
  ufw delete allow 443/udp &>/dev/null || true
  for range in $ranges; do
    ufw allow proto tcp from "$range" to any port 80,443 >/dev/null
  done
else
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null # HTTP/3
fi
ufw --force enable >/dev/null
ufw status | sed -n '1,4p'

# ---------------------------------------------------------------------------
say 'SSH'
admin="${SUDO_USER:-root}"
admin_home=$(getent passwd "$admin" | cut -d: -f6)
if [[ -s $admin_home/.ssh/authorized_keys ]] &&
  grep -qE '^(ssh-|ecdsa-|sk-)' "$admin_home/.ssh/authorized_keys"; then
  # Keys only. Checked first: turning passwords off for an account that has no
  # key would lock its owner out of their own server.
  root_login=no
  [[ $admin == root ]] && root_login=prohibit-password
  cat >/etc/ssh/sshd_config.d/10-klea.conf <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin $root_login
EOF
  # sshd checks its configuration against this directory, which only exists
  # while the SSH server has been started at least once since boot.
  install -d -m 755 /run/sshd
  sshd -t
  systemctl try-reload-or-restart ssh
  echo "Password login disabled; $admin signs in with their SSH key."
else
  warn "No SSH key found for $admin: password login left ON. Add your key to"
  warn "$admin_home/.ssh/authorized_keys and run this script again."
fi

# ---------------------------------------------------------------------------
say 'Done'
cat <<EOF
Next (docs/DEPLOYMENT.md):
  1. Fill in the four FILL IN values:   sudo nano $ETC/env
  2. Deploy:                            sudo klea-deploy
  3. Create the first administrator:    sudo klea-create-admin
  4. Set up backups:                    sudo nano $ETC/backup.env   and   sudo rclone config
EOF
