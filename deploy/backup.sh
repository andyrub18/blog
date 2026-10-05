#!/usr/bin/env bash
#
# Encrypted backup of the database and the uploads, copied off the server.
# Installed as /usr/local/sbin/klea-backup; run nightly by klea-backup.timer,
# or by hand: sudo klea-backup
#
# Both are encrypted with age before they are written, to a public key whose
# private half is NOT on this server (BACKUP_AGE_RECIPIENT in
# /etc/klea/backup.env). A backup is a copy of every dossier; a server that is
# broken into must not be able to read its own backups, and neither must
# whoever stores them. Restoring is in docs/DEPLOYMENT.md, step 7.
#
# Exits non-zero — and so shows in `systemctl --failed` — whenever the night's
# backup did not reach the other provider. A backup that only exists on the
# machine it is meant to protect against losing is not done.

set -Eeuo pipefail
umask 077

ETC=/etc/klea
DIR=/var/backups/klea

die() { printf 'klea-backup: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die 'run as root'
set -a
# shellcheck source=/dev/null
. "$ETC/env"
# shellcheck source=/dev/null
. "$ETC/backup.env"
set +a
[[ -n ${BACKUP_AGE_RECIPIENT:-} ]] ||
  die "BACKUP_AGE_RECIPIENT is empty in $ETC/backup.env — nothing can be encrypted, so nothing is written."

stamp=$(date -u +%Y%m%dT%H%M%SZ)
db_file="$DIR/klea-db-$stamp.dump.age"
uploads_file="$DIR/klea-uploads-$stamp.tar.age"

# Written under a temporary name and renamed when complete, so a backup cut short
# never looks like a finished one.
pg_dump --format=custom --no-owner "$DATABASE_URL" |
  age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" >"$db_file.partial"
mv "$db_file.partial" "$db_file"

tar -C "$(dirname "$UPLOAD_ROOT")" -cf - "$(basename "$UPLOAD_ROOT")" |
  age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" >"$uploads_file.partial"
mv "$uploads_file.partial" "$uploads_file"

echo "Encrypted: $(du -h "$db_file" | cut -f1) database, $(du -h "$uploads_file" | cut -f1) uploads."

# Local copies are kept a few days, for a quick restore after a mistake.
find "$DIR" -name 'klea-*.age' -mtime "+${BACKUP_KEEP_LOCAL_DAYS:-7}" -delete
find "$DIR" -name 'klea-*.partial' -delete

[[ -n ${BACKUP_REMOTE:-} ]] ||
  die "BACKUP_REMOTE is empty in $ETC/backup.env — tonight's backup exists only on this server."

rclone copyto "$db_file" "$BACKUP_REMOTE/$(basename "$db_file")"
rclone copyto "$uploads_file" "$BACKUP_REMOTE/$(basename "$uploads_file")"
# Checked after copying, by size, rather than trusted.
for file in "$db_file" "$uploads_file"; do
  remote_size=$(rclone size --json "$BACKUP_REMOTE/$(basename "$file")" | sed -E 's/.*"bytes":([0-9]+).*/\1/')
  [[ $remote_size == $(stat -c %s "$file") ]] || die "copy of $(basename "$file") is incomplete"
done
rclone delete --min-age "${BACKUP_KEEP_REMOTE_DAYS:-90}d" --include 'klea-*.age' "$BACKUP_REMOTE"
echo "Copied to $BACKUP_REMOTE."
