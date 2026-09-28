# Deploying PrintFlex to the dev server

Target: `devteam01@187.52.115.100`, served as `https://dev.printflex.mpctrades.com`
by Nginx, run by pm2 on port 3011. Data lives outside the app folder so a
redeploy never touches it:

- app code: `/home/devteam01/printflex`
- database: PostgreSQL `printflex_dev` (role `printflex_dev`) on the same server
- PDFs: `/home/devteam01/printflex-data/storage`
- secrets: `/home/devteam01/printflex/.env` (never committed; see `env.example`)

Until 28 Sep 2026 dev ran on SQLite. That file is kept, unchanged, at
`/home/devteam01/printflex-data/dev.sqlite` (plus `dev.sqlite.pre-postgres-20260928`),
and the old env at `.env.sqlite-backup`. The data was copied with
`scripts/copy-sqlite-to-postgres.ts`.

Production is a separate environment with its own app, database and secrets:
see `deploy/production/README.md`.

Files here:

- `env.example` - the variables the server needs.
- `ecosystem.config.cjs` - pm2 process definition; reads `.env` at start.
- `nginx.conf` - the vhost; copy to `/etc/nginx/sites-available/`.
- `server-setup.sh` - one-time server preparation (Chromium libraries, folders, pm2 on boot).
- `deploy.sh` - run from your Mac for every release: rsync, install, migrate, build, reload
  (the steps live in `deploy/common.sh`, shared with production).
