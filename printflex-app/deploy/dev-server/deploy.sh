#!/usr/bin/env bash
# Deploy the current checkout to the live app (dev.printflex.mpctrades.com, database printflex_dev).
# Run from the printflex-app folder on your Mac:
#   bash deploy/dev-server/deploy.sh
# Takes a database backup first; if the backup fails, nothing is deployed.
set -euo pipefail

HOST="devteam01@187.52.115.100"
REMOTE="/home/devteam01/printflex"
ECOSYSTEM="deploy/dev-server/ecosystem.config.cjs"
PM2_NAME="printflex-dev"
PORT="3011"
PUBLIC_URL="https://dev.printflex.mpctrades.com"

echo "== Backup before migrating"
ssh "$HOST" "bash $REMOTE/deploy/dev-server/backup.sh pre-deploy" || { echo "Backup failed, so nothing was deployed."; exit 1; }

. "$(dirname "$0")/../common.sh"
