#!/usr/bin/env bash
#
# Create the first super administrator. Installed as
# /usr/local/sbin/klea-create-admin; run once, after the first deploy:
#
#   sudo klea-create-admin
#
# Asks for the password at a prompt, so it never lands in the shell history or
# in the list of running processes the way a command-line argument would.

set -Eeuo pipefail

die() { printf '\033[31mxx %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die 'Run as root: sudo klea-create-admin'
[[ -d /srv/klea/current ]] || die 'Deploy first: sudo klea-deploy'

read -rp 'Administrator email: ' email
read -rp 'Display name: ' name
read -rsp 'Password (12 characters or more): ' password
echo
read -rsp 'Same password again: ' again
echo
[[ $password == "$again" ]] || die 'The two passwords differ.'
[[ ${#password} -ge 12 ]] || die 'Use at least 12 characters: this account can read every dossier.'

cd /srv/klea/current
SUPER_ADMIN_EMAIL="$email" SUPER_ADMIN_NAME="$name" SUPER_ADMIN_PASSWORD="$password" \
  runuser -u klea -- bash -c '
    set -a; . /etc/klea/env; set +a
    export SUPER_ADMIN_EMAIL SUPER_ADMIN_NAME SUPER_ADMIN_PASSWORD
    exec env HOME=/srv/klea npx tsx scripts/seed-super-admin.ts'
