#!/usr/bin/env bash
# Deploy the current checkout to the DEV environment (dev.printflex.mpctrades.com, database printflex_dev).
# Run from the printflex-app folder on your Mac:
#   bash deploy/dev-server/deploy.sh
set -euo pipefail

HOST="devteam01@187.52.115.100"
REMOTE="/home/devteam01/printflex"
ECOSYSTEM="deploy/dev-server/ecosystem.config.cjs"
PM2_NAME="printflex-dev"
PORT="3011"
PUBLIC_URL="https://dev.printflex.mpctrades.com"

. "$(dirname "$0")/../common.sh"
