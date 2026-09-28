# PrintFlex production

Served as `https://app.printflex.mpctrades.com` by Nginx on `devteam01@187.52.115.100`, run by pm2
as `printflex-prod` on port 3012. It shares the machine with dev but nothing else:

| | Production | Dev |
|---|---|---|
| URL | app.printflex.mpctrades.com | dev.printflex.mpctrades.com |
| Shopify app | PrintFlex (client_id `34363db3…`, the listed app) | PrintFlex Dev (its own client_id) |
| Config | `shopify.app.production.toml` | `shopify.app.toml` |
| pm2 / port | `printflex-prod` / 3012 | `printflex-dev` / 3011 |
| Code | `/home/devteam01/printflex-prod` | `/home/devteam01/printflex` |
| Database | PostgreSQL `printflex_prod`, role `printflex_prod` | `printflex_dev`, role `printflex_dev` |
| PDFs | `/home/devteam01/printflex-prod-data/storage` | `/home/devteam01/printflex-data/storage` |
| Secrets | `/home/devteam01/printflex-prod/.env` | `/home/devteam01/printflex/.env` |

Each database role can connect only to its own database (`CONNECT` is revoked from `PUBLIC`).

## Deploying

```
bash deploy/production/deploy.sh
```

It refuses unless you are on a clean `main` that matches `origin/main`, asks you to type
`production`, takes a `pre-deploy` backup, then runs the same steps as dev (`deploy/common.sh`):
rsync, `npm ci`, `prisma migrate deploy`, build, pm2 reload, health checks.

Shopify-side configuration (URLs, scopes, webhooks) is pushed separately, and only when it changes:

```
shopify app deploy --config production
```

## Backups

`backup.sh` writes a compressed `pg_dump` to `/home/devteam01/printflex-prod-data/backups`:

- nightly at 03:15 UTC from cron (keeps the newest 14), log in `backups/backup.log`
- before every production deploy (keeps the newest 10)
- each dump is checked with `pg_restore --list` before it counts
- copied offsite when `PRINTFLEX_BACKUP_REMOTE` is set in the production `.env` (an rclone remote,
  e.g. `b2:printflex-backups/prod`)

Generated PDFs are not backed up: they are a 30-day cache and are regenerated from Shopify on
demand. Logos and templates live in the database, so the dump covers them.

List backups:

```
ssh devteam01@187.52.115.100 'ls -lht ~/printflex-prod-data/backups | head'
```

Take one now:

```
ssh devteam01@187.52.115.100 'bash ~/printflex-prod/deploy/production/backup.sh manual'
```

## Restoring

Restoring replaces the production data with the backup's. Everything written since that backup
(orders synced, documents, pack events) is lost from PrintFlex; Shopify itself is unaffected, and
orders resync on the next backfill or webhook.

1. Pick the dump (for an offsite one, first `rclone copy b2:printflex-backups/prod/<file> ~/printflex-prod-data/backups/`).
2. Stop the app and take a safety backup of the current state:
   ```
   ssh devteam01@187.52.115.100
   export PATH=/home/devteam01/node24/bin:$PATH
   pm2 stop printflex-prod
   bash ~/printflex-prod/deploy/production/backup.sh pre-restore
   ```
3. Restore into the production database (drops and recreates every PrintFlex table):
   ```
   DB=$(grep '^DATABASE_URL=' ~/printflex-prod/.env | cut -d= -f2-)
   pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction \
     --dbname="$DB" ~/printflex-prod-data/backups/<file>.dump
   ```
4. Start the app and check it:
   ```
   pm2 start printflex-prod
   curl -s -o /dev/null -w "%{http_code}\n" https://app.printflex.mpctrades.com/
   ```

To inspect a backup without touching production, restore it into a scratch database instead
(`sudo -u postgres createdb -O printflex_prod printflex_restore_check`, restore with that name in
the URL, look around, then `sudo -u postgres dropdb printflex_restore_check`).

## One-time setup

1. DNS: A record `app.printflex.mpctrades.com` -> `187.52.115.100`.
2. Database and role (done 28 Sep 2026): `printflex_prod` owned by `printflex_prod`; the URL with
   its generated password is in `/home/devteam01/.printflex_prod_dburl` (mode 600).
3. Sync the code once so the setup script is on the server, then run it:
   `bash ~/printflex-prod/deploy/production/server-setup.sh` (Nginx vhost, certificate, backup cron).
4. Create `/home/devteam01/printflex-prod/.env` from `env.example` and paste the app's API secret.
5. `bash deploy/production/deploy.sh`, then `shopify app deploy --config production`.
