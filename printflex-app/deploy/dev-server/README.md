# Deploying PrintFlex to the dev server

Target: `devteam01@187.52.115.100`, served as `https://dev.printflex.mpctrades.com`
by Nginx, run by pm2 on port 3011. Data lives outside the app folder so a
redeploy never touches it:

- app code: `/home/devteam01/printflex`
- database and PDFs: `/home/devteam01/printflex-data` (`dev.sqlite`, `storage/`)
- secrets: `/home/devteam01/printflex/.env` (never committed; see `env.example`)

Files here:

- `env.example` - the variables the server needs.
- `ecosystem.config.cjs` - pm2 process definition; reads `.env` at start.
- `nginx.conf` - the vhost; copy to `/etc/nginx/sites-available/`.
- `server-setup.sh` - one-time server preparation (Chromium libraries, folders, pm2 on boot).
- `deploy.sh` - run from your Mac for every release: rsync, install, migrate, build, reload.
