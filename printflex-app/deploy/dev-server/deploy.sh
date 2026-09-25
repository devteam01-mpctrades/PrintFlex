#!/usr/bin/env bash
# Deploy the current checkout to the dev server. Run from the printflex-app folder on your Mac:
#   bash deploy/dev-server/deploy.sh
set -euo pipefail

HOST="devteam01@187.52.115.100"
REMOTE="/home/devteam01/printflex"

echo "== Sync code (node_modules, build and data are rebuilt or kept on the server)"
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude build --exclude storage --exclude '*.sqlite*' \
  --exclude .env --exclude .shopify --exclude extensions/*/dist --exclude prisma/schema.server.prisma \
  ./ "$HOST:$REMOTE/"

echo "== Install, migrate, build, restart"
ssh "$HOST" bash -s <<'REMOTE_EOF'
set -euo pipefail
export PATH="/home/devteam01/node24/bin:$PATH"   # the app needs Node 24; the system Node stays 22 for other apps
cd /home/devteam01/printflex
[ -f .env ] || { echo "Missing /home/devteam01/printflex/.env (see deploy/dev-server/env.example)"; exit 1; }
set -a; . ./.env; set +a
npm ci --include=dev --no-audit --no-fund
# The schema hardcodes the dev file; migrate against DATABASE_URL through a server-only copy of the schema
# (it must sit next to prisma/migrations, which is resolved relative to the schema file).
sed 's#url *= *"file:dev.sqlite"#url = env("DATABASE_URL")#' prisma/schema.prisma > prisma/schema.server.prisma
npx prisma migrate deploy --schema prisma/schema.server.prisma
npm run build
pm2 startOrReload deploy/dev-server/ecosystem.config.cjs --update-env
pm2 save >/dev/null
sleep 2
curl -s -o /dev/null -w "local health: HTTP %{http_code}\n" http://127.0.0.1:3011/ || true
REMOTE_EOF

echo "== Public check"
curl -s -o /dev/null -w "https://dev.printflex.mpctrades.com -> HTTP %{http_code}\n" https://dev.printflex.mpctrades.com/ || true
