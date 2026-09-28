# Deploying PrintFlex

Target: `devteam01@187.52.115.100`, served as `https://dev.printflex.mpctrades.com`
by Nginx, run by pm2 on port 3011. Data lives outside the app folder so a
redeploy never touches it:

- app code: `/home/devteam01/printflex`
- database: PostgreSQL `printflex_dev` (role `printflex_dev`) on the same server
- PDFs: `/home/devteam01/printflex-data/storage`
- backups: `/home/devteam01/printflex-data/backups`
- secrets: `/home/devteam01/printflex/.env` (never committed; see `env.example`)

Until 28 Sep 2026 dev ran on SQLite. That file is kept, unchanged, at
`/home/devteam01/printflex-data/dev.sqlite` (plus `dev.sqlite.pre-postgres-20260928`),
and the old env at `.env.sqlite-backup`. The data was copied with
`scripts/copy-sqlite-to-postgres.ts`.

This is the one environment: the listed PrintFlex app (client_id `34363db3…`, `shopify.app.toml`)
points here.

Files here:

- `env.example` - the variables the server needs.
- `ecosystem.config.cjs` - pm2 process definition; reads `.env` at start.
- `nginx.conf` - the vhost; copy to `/etc/nginx/sites-available/`.
- `server-setup.sh` - one-time server preparation (Chromium libraries, folders, pm2 on boot).
- `deploy.sh` - run from your Mac for every release: backup, rsync, install, migrate, build, reload
  (the steps after the backup live in `deploy/common.sh`).
- `backup.sh` - database backup, run nightly by cron and before every deploy.

## Backups

`backup.sh` writes a compressed `pg_dump` of `printflex_dev` to `/home/devteam01/printflex-data/backups`:

- nightly at 03:15 UTC from cron (keeps the newest 14), log in `backups/backup.log`
- before every deploy (keeps the newest 10); a failed backup stops the deploy
- each dump is checked with `pg_restore --list` before it counts
- copied offsite when `PRINTFLEX_BACKUP_REMOTE` is set in `.env` (an rclone remote, e.g. `b2:printflex-backups`)

Generated PDFs are not backed up: they are a 30-day cache and are regenerated from Shopify on
demand. Logos and templates live in the database, so the dump covers them.

The cron entry (installed once, `crontab -l` to check):

```
15 3 * * * bash /home/devteam01/printflex/deploy/dev-server/backup.sh >> /home/devteam01/printflex-data/backups/backup.log 2>&1
```

List backups, or take one now:

```
ssh devteam01@187.52.115.100 'ls -lht ~/printflex-data/backups | head'
ssh devteam01@187.52.115.100 'bash ~/printflex/deploy/dev-server/backup.sh manual'
```

## Restoring

Restoring replaces the app's data with the backup's. Everything written since that backup (synced
orders, documents, pack events) is lost from PrintFlex; Shopify itself is unaffected, and orders
resync on the next backfill or webhook.

1. Pick the dump (for an offsite one, first `rclone copy b2:printflex-backups/<file> ~/printflex-data/backups/`).
2. Stop the app and take a safety backup of the current state:
   ```
   ssh devteam01@187.52.115.100
   export PATH=/home/devteam01/node24/bin:$PATH
   pm2 stop printflex-dev
   bash ~/printflex/deploy/dev-server/backup.sh pre-restore
   ```
3. Restore (drops and recreates every PrintFlex table, all in one transaction):
   ```
   DB=$(grep '^DATABASE_URL=' ~/printflex/.env | cut -d= -f2-)
   pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction \
     --dbname="$DB" ~/printflex-data/backups/<file>.dump
   ```
4. Start the app and check it:
   ```
   pm2 start printflex-dev
   curl -s -o /dev/null -w "%{http_code}\n" https://dev.printflex.mpctrades.com/
   ```

To inspect a backup without touching the live data, restore it into a scratch database instead:
`sudo -u postgres createdb -O printflex_dev printflex_restore_check`, restore with that database
name in the URL, look around, then `sudo -u postgres dropdb printflex_restore_check`.
