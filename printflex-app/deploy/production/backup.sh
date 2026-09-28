#!/usr/bin/env bash
# Back up the production database. Runs ON the server:
#   nightly from cron:     bash /home/devteam01/printflex-prod/deploy/production/backup.sh
#   before each deploy:    bash .../backup.sh pre-deploy
# Writes a compressed pg_dump (custom format, restorable with pg_restore) to
# /home/devteam01/printflex-prod-data/backups, keeps the newest 14 nightly and 10 pre-deploy dumps,
# and copies each new dump offsite when PRINTFLEX_BACKUP_REMOTE is set in the production .env.
set -euo pipefail

KIND="${1:-nightly}"
ROOT="/home/devteam01/printflex-prod"
DIR="/home/devteam01/printflex-prod-data/backups"
KEEP_NIGHTLY=14
KEEP_PREDEPLOY=10

DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2-)
BACKUP_REMOTE=$(grep -E '^PRINTFLEX_BACKUP_REMOTE=' "$ROOT/.env" | head -1 | cut -d= -f2- || true)
case "$DATABASE_URL" in postgres*) ;; *) echo "No PostgreSQL DATABASE_URL in $ROOT/.env"; exit 1 ;; esac

umask 077
mkdir -p "$DIR"
file="$DIR/printflex_prod-$KIND-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$file.partial"
pg_restore --list "$file.partial" >/dev/null   # a dump that cannot be listed is not a backup
mv "$file.partial" "$file"
echo "backup: $file ($(du -h "$file" | cut -f1))"

keep=$KEEP_NIGHTLY; [ "$KIND" = "pre-deploy" ] && keep=$KEEP_PREDEPLOY
ls -1t "$DIR"/printflex_prod-"$KIND"-*.dump 2>/dev/null | tail -n +$((keep + 1)) | xargs -r rm -f

if [ -n "$BACKUP_REMOTE" ]; then
  rclone copy "$file" "$BACKUP_REMOTE/" && echo "offsite: $BACKUP_REMOTE/$(basename "$file")"
else
  echo "offsite: skipped (PRINTFLEX_BACKUP_REMOTE is not set)"
fi
