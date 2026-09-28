#!/usr/bin/env bash
# One-time preparation of PRODUCTION on the server, after the dev setup (Chromium libraries, Node 24,
# pm2 on boot) already ran. Run ON the server as devteam01, once the DNS record for
# app.printflex.mpctrades.com points at this server:
#   bash ~/printflex-prod/deploy/production/server-setup.sh
# The printflex_prod database and role were created separately; see README.md.
set -euo pipefail

DOMAIN="app.printflex.mpctrades.com"
ROOT="/home/devteam01/printflex-prod"

echo "== Folders (code, PDFs, backups), separate from dev"
mkdir -p "$ROOT" /home/devteam01/printflex-prod-data/storage /home/devteam01/printflex-prod-data/backups
chmod 700 /home/devteam01/printflex-prod-data/backups

echo "== Nginx vhost"
if [ ! -f "/etc/nginx/sites-available/$DOMAIN" ]; then
  sudo cp "$ROOT/deploy/production/nginx.conf" "/etc/nginx/sites-available/$DOMAIN"
  sudo ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
  sudo nginx -t && sudo systemctl reload nginx
fi

echo "== TLS certificate (Let's Encrypt via certbot; renews on its timer)"
if ! sudo certbot certificates 2>/dev/null | grep -q "$DOMAIN"; then
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
fi

echo "== Nightly database backup at 03:15 UTC"
line="15 3 * * * bash $ROOT/deploy/production/backup.sh >> /home/devteam01/printflex-prod-data/backups/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v "deploy/production/backup.sh" ; echo "$line" ) | crontab -

echo "Done. Fill in $ROOT/.env (see env.example), then run deploy/production/deploy.sh from your Mac."
