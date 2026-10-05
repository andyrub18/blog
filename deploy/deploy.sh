#!/usr/bin/env bash
#
# Deploy KLEA: build a new release, migrate, switch to it, check it. Installed
# as /usr/local/sbin/klea-deploy by setup-server.sh.
#
#   sudo klea-deploy              # the latest commit of the configured branch
#   sudo klea-deploy <commit>     # a specific commit, e.g. to go back to one
#
# Each release is built in a directory of its own while the current one keeps
# serving; the switch is one symlink, and if the new release does not answer,
# the symlink goes back. Database migrations are not undone by that — they only
# ever move forward — which is why each one is tested before it is merged.

set -Eeuo pipefail

APP_HOME=/srv/klea
ETC=/etc/klea
KEEP_RELEASES=3

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31mxx %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die 'Run as root: sudo klea-deploy'
[[ -f $ETC/env && -f $ETC/deploy.env ]] || die "Run setup-server.sh first ($ETC is not set up)."
# shellcheck source=/dev/null
. "$ETC/deploy.env"

# ---------------------------------------------------------------------------
say 'Settings'
# The server refuses to start without these (src/boot.ts). Saying so here,
# before anything is built, is kinder than a failed restart after five minutes.
missing=$(
  set -a
  # shellcheck source=/dev/null
  . "$ETC/env"
  for name in DATABASE_URL BETTER_AUTH_SECRET BETTER_AUTH_URL CLIENT_IP_HEADER UPLOAD_ROOT \
    RESEND_API_KEY EMAIL_FROM TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY; do
    [[ -n ${!name:-} ]] || echo "$name"
  done
  [[ ${ALLOW_INSECURE_LOCAL:-} != true ]] || echo 'ALLOW_INSECURE_LOCAL must not be set on a server'
)
[[ -z $missing ]] || die "Fill in $ETC/env first. Missing: $(echo "$missing" | tr '\n' ' ')"
echo 'All required settings present.'

as_klea() { runuser -u klea -- "$@"; }
# Runs a command as klea with the production settings in its environment.
as_klea_with_env() {
  runuser -u klea -- bash -c 'set -a; . /etc/klea/env; set +a; exec "$@"' bash "$@"
}

# ---------------------------------------------------------------------------
say 'Code'
as_klea git -C "$APP_HOME/repo" fetch --prune origin
target="${1:-origin/$BRANCH}"
sha=$(as_klea git -C "$APP_HOME/repo" rev-parse --verify "$target^{commit}") ||
  die "Unknown commit: $target"
release="$APP_HOME/releases/$(date -u +%Y%m%d%H%M%S)-${sha:0:12}"
# A release that fails — before the switch, or after it and rolled back — is
# deleted, so failed attempts never push good releases out of the three kept.
switched=0
cleanup() {
  if [[ $switched == 0 && -d $release ]]; then
    rm -rf -- "$release"
    echo "Removed $release; the site is serving what it served before." >&2
  fi
}
trap cleanup EXIT
as_klea mkdir "$release"
as_klea bash -c "git -C '$APP_HOME/repo' archive '$sha' | tar -x -C '$release'"
echo "Release $release ($(as_klea git -C "$APP_HOME/repo" log -1 --format='%h %s' "$sha"))"

# ---------------------------------------------------------------------------
say 'Build'
# Dev dependencies included: the build, the migrations and the admin seed need
# them. npm's cache lives in klea's home, so later builds download less.
#
# npm skips an *optional* package whose download fails and still reports
# success — and the native parts of the build tools (rolldown, lightningcss)
# are optional packages. The build then dies with "Cannot find native binding"
# and npm's advice to delete package-lock.json, which is wrong: the lockfile is
# what pins every version. More patient retries make that rarer; the message
# below says what it means when it happens anyway.
(cd "$release" && as_klea env HOME="$APP_HOME" npm ci --no-audit --no-fund \
  --fetch-retries=5 --fetch-retry-maxtimeout=120000)
(cd "$release" && as_klea env HOME="$APP_HOME" npm run build) ||
  die 'The build failed. If the error above mentions a missing native binding or module, a download was cut short during installation: run klea-deploy again. Do not delete package-lock.json.'

# ---------------------------------------------------------------------------
say 'Database migrations'
(cd "$release" && as_klea_with_env env HOME="$APP_HOME" npx drizzle-kit migrate)

# ---------------------------------------------------------------------------
say 'Switch'
previous=$(readlink -f "$APP_HOME/current" 2>/dev/null || true)

place() { # place <mode> <source> <destination>
  local tmp
  tmp=$(mktemp "$3.XXXXXX")
  install -m "$1" "$2" "$tmp"
  mv -f "$tmp" "$3"
}

# The service definitions come with the release, and go back with it: a release
# rolled back to runs under the unit it was deployed with, not the new one.
switch_to() {
  local unit
  for unit in klea.service klea-backup.service klea-backup.timer; do
    place 644 "$1/deploy/$unit" "/etc/systemd/system/$unit"
  done
  systemctl daemon-reload
  as_klea ln -sfn "$1" "$APP_HOME/current.next"
  mv -Tf "$APP_HOME/current.next" "$APP_HOME/current"
  systemctl restart klea
}
switch_to "$release"
switched=1

# ---------------------------------------------------------------------------
say 'Check'
healthy() {
  local code
  for _ in $(seq 1 30); do
    if ! systemctl is-active --quiet klea && [[ $(systemctl show -p ExecMainStatus --value klea) != 0 ]]; then
      return 1
    fi
    code=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Real-IP: 127.0.0.1' http://127.0.0.1:3000/fr/ || true)
    [[ $code == 200 ]] && return 0
    sleep 2
  done
  return 1
}
if ! healthy; then
  journalctl -u klea -n 25 --no-pager || true
  if [[ -n $previous && -d $previous ]]; then
    printf '\033[31mxx The new release did not answer. Going back to %s.\033[0m\n' "$previous" >&2
    switch_to "$previous"
    switched=0 # so the release that failed is removed on the way out
    die 'Deploy failed and was rolled back. Migrations, if any ran, stay applied.'
  fi
  die 'Deploy failed: the server did not answer (see the log above).'
fi
echo 'The app answers on 127.0.0.1:3000.'

# Through Caddy, as a visitor would. A warning rather than a failure: on a brand
# new domain the certificate may still be on its way.
headers=$(curl -sSI -k --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/fr/" 2>&1 || true)
if grep -qi '^content-security-policy:.*nonce-' <<<"$headers" &&
  grep -qi '^strict-transport-security:' <<<"$headers"; then
  echo "https://$DOMAIN serves the page with its security headers."
else
  printf '\033[33m!! Could not confirm https://%s through Caddy yet:\033[0m\n%s\n' "$DOMAIN" \
    "$(head -3 <<<"$headers")"
fi

# The newest scripts, for next time.
place 755 "$release/deploy/deploy.sh" /usr/local/sbin/klea-deploy
place 755 "$release/deploy/backup.sh" /usr/local/sbin/klea-backup
place 755 "$release/deploy/create-admin.sh" /usr/local/sbin/klea-create-admin

# ---------------------------------------------------------------------------
say 'Old releases'
current=$(readlink -f "$APP_HOME/current")
# Newest first, by name: release directories start with their UTC timestamp.
mapfile -t releases < <(ls -1d "$APP_HOME"/releases/*/ 2>/dev/null | sed 's:/$::' | sort -r)
kept=0
for dir in "${releases[@]}"; do
  if [[ $dir == "$current" ]] || ((kept < KEEP_RELEASES)); then
    kept=$((kept + 1))
    continue
  fi
  rm -rf -- "$dir"
  echo "Removed $dir"
done

say "Deployed ${sha:0:12}"
