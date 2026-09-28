#!/usr/bin/env bash
# The deploy steps. Not run directly: deploy/dev-server/deploy.sh sets the variables below and
# sources this file, so another environment can reuse the same steps with its own values.
#   HOST        ssh target
#   REMOTE      app checkout on the server
#   ECOSYSTEM   pm2 file, relative to REMOTE
#   PM2_NAME    pm2 process name
#   PORT        local port the process listens on
#   PUBLIC_URL  https URL checked at the end
set -euo pipefail
: "${HOST:?}" "${REMOTE:?}" "${ECOSYSTEM:?}" "${PM2_NAME:?}" "${PORT:?}" "${PUBLIC_URL:?}"

echo "== Sync code to $HOST:$REMOTE (node_modules, build, data and .env stay on the server)"
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude build --exclude storage --exclude '*.sqlite*' \
  --exclude '.env' --exclude '.env.*' --exclude .shopify --exclude 'extensions/*/dist' \
  ./ "$HOST:$REMOTE/"

echo "== Install, migrate, build, restart $PM2_NAME"
ssh "$HOST" REMOTE="$REMOTE" ECOSYSTEM="$ECOSYSTEM" PM2_NAME="$PM2_NAME" PORT="$PORT" bash -s <<'REMOTE_EOF'
set -euo pipefail
export PATH="/home/devteam01/node24/bin:$PATH"   # the app needs Node 24; the system Node stays 22 for other apps
cd "$REMOTE"
[ -f .env ] || { echo "Missing $REMOTE/.env (see env.example next to the deploy script)"; exit 1; }
set -a; . ./.env; set +a
case "${DATABASE_URL:-}" in postgres*) ;; *) echo "DATABASE_URL in $REMOTE/.env must be a PostgreSQL URL"; exit 1 ;; esac
npm ci --include=dev --no-audit --no-fund
npx prisma generate >/dev/null
npx prisma migrate deploy
npm run build
pm2 startOrReload "$ECOSYSTEM" --update-env
pm2 save >/dev/null
sleep 2
curl -s -o /dev/null -w "local health: HTTP %{http_code}\n" "http://127.0.0.1:$PORT/" || true
REMOTE_EOF

echo "== Public check"
curl -s -o /dev/null -w "$PUBLIC_URL -> HTTP %{http_code}\n" "$PUBLIC_URL/" || true
