#!/usr/bin/env bash
# One-time preparation of the dev server. Run ON the server as devteam01:
#   bash ~/printflex/deploy/dev-server/server-setup.sh
set -euo pipefail

echo "== Chromium libraries for the PDF renderer (Puppeteer downloads Chrome itself on npm ci)"
sudo apt-get update -qq
sudo apt-get install -y -qq libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2 \
  libxshmfence1 fonts-liberation fonts-noto-core

echo "== Node 24 for this user only (the app needs it; the system Node stays as is for other apps)"
if [ ! -x /home/devteam01/node24/bin/node ]; then
  VER=$(curl -s https://nodejs.org/dist/index.json | grep -o '"v24\.[0-9]*\.[0-9]*"' | head -1 | tr -d '"')
  curl -sSL -o /tmp/node24.tar.xz "https://nodejs.org/dist/$VER/node-$VER-linux-x64.tar.xz"
  mkdir -p /home/devteam01/node24 && tar -xJf /tmp/node24.tar.xz -C /home/devteam01/node24 --strip-components=1 && rm /tmp/node24.tar.xz
fi

echo "== Data folders outside the app checkout"
mkdir -p /home/devteam01/printflex-data/storage /home/devteam01/printflex

echo "== pm2 starts on boot"
sudo env PATH="$PATH" pm2 startup systemd -u devteam01 --hp /home/devteam01 >/dev/null

echo "== Nginx vhost"
if [ ! -f /etc/nginx/sites-available/dev.printflex.mpctrades.com ]; then
  sudo cp /home/devteam01/printflex/deploy/dev-server/nginx.conf /etc/nginx/sites-available/dev.printflex.mpctrades.com
  sudo ln -sf /etc/nginx/sites-available/dev.printflex.mpctrades.com /etc/nginx/sites-enabled/dev.printflex.mpctrades.com
  sudo nginx -t && sudo systemctl reload nginx
fi

echo "== TLS certificate (Let's Encrypt via certbot; renews on its timer)"
if ! sudo certbot certificates 2>/dev/null | grep -q "dev.printflex.mpctrades.com"; then
  sudo certbot --nginx -d dev.printflex.mpctrades.com --non-interactive --agree-tos --register-unsafely-without-email --redirect
fi

echo "Done. Now create /home/devteam01/printflex/.env from deploy/dev-server/env.example, then run deploy.sh from your Mac."
