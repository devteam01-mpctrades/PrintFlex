#!/usr/bin/env bash
# Deploy the current checkout to PRODUCTION (app.printflex.mpctrades.com, database printflex_prod).
# Run from the printflex-app folder on your Mac:
#   bash deploy/production/deploy.sh
# Only a clean, pushed main branch deploys, so production always matches a commit on GitHub.
set -euo pipefail

HOST="devteam01@187.52.115.100"
REMOTE="/home/devteam01/printflex-prod"
ECOSYSTEM="deploy/production/ecosystem.config.cjs"
PM2_NAME="printflex-prod"
PORT="3012"
PUBLIC_URL="https://app.printflex.mpctrades.com"

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || { echo "Production deploys from main; you are on $branch."; exit 1; }
[ -z "$(git status --porcelain -- .)" ] || { echo "Commit or stash your changes first; production must match a commit."; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "Push main first (or pull); HEAD is not origin/main."; exit 1; }

echo "About to deploy $(git log --oneline -1) to PRODUCTION ($PUBLIC_URL)."
read -r -p "Type 'production' to continue: " answer
[ "$answer" = "production" ] || { echo "Cancelled."; exit 1; }

echo "== Backup before migrating"
if ssh "$HOST" "test -f $REMOTE/deploy/production/backup.sh"; then
  ssh "$HOST" "bash $REMOTE/deploy/production/backup.sh pre-deploy" || { echo "Backup failed, so nothing was deployed."; exit 1; }
else
  echo "First deploy: no backup script on the server yet, so there is nothing to back up."
fi

. "$(dirname "$0")/../common.sh"
