#!/usr/bin/env bash
# One-time setup of encrypted offsite backups to Backblaze B2. Run ON the server, in your own terminal
# (not through Claude, so the key and passwords never reach a chat log):
#   ssh -t devteam01@187.52.115.100 'bash ~/printflex/deploy/dev-server/offsite-setup.sh'
#
# Creates two rclone remotes in ~/.config/rclone/rclone.conf (mode 600):
#   printflex-b2       the bucket, with the restricted application key
#   printflex-offsite  a crypt layer on top: files are encrypted here before upload, so Backblaze
#                      only ever stores ciphertext
# It prints the two encryption passwords once. Save them in a password manager: without them the
# offsite copies cannot be decrypted, for example after losing this server.
set -euo pipefail
RCLONE=/home/devteam01/bin/rclone
[ -x "$RCLONE" ] || { echo "rclone is missing at $RCLONE"; exit 1; }

if "$RCLONE" listremotes | grep -q '^printflex-offsite:$'; then
  echo "printflex-offsite is already configured. Nothing changed."
  echo "To start over: $RCLONE config delete printflex-offsite && $RCLONE config delete printflex-b2"
  exit 0
fi

read -r -p "Backblaze bucket name: " BUCKET
read -r -s -p "keyID (hidden): " KEY_ID; echo
read -r -s -p "applicationKey (hidden): " APP_KEY; echo
[ -n "$BUCKET" ] && [ -n "$KEY_ID" ] && [ -n "$APP_KEY" ] || { echo "All three are required."; exit 1; }

umask 077
"$RCLONE" config create printflex-b2 b2 account "$KEY_ID" key "$APP_KEY" hard_delete true >/dev/null
echo "Checking the key can reach the bucket…"
if ! "$RCLONE" lsf "printflex-b2:$BUCKET" --max-depth 1 >/dev/null 2>&1; then
  "$RCLONE" config delete printflex-b2
  echo "Could not open bucket '$BUCKET' with that key. Check the bucket name and that the key is for that bucket, then run this again."
  exit 1
fi

PASS=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)
SALT=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)
"$RCLONE" config create printflex-offsite crypt remote "printflex-b2:$BUCKET/printflex" \
  password "$("$RCLONE" obscure "$PASS")" password2 "$("$RCLONE" obscure "$SALT")" \
  filename_encryption standard directory_name_encryption true >/dev/null
chmod 600 "$HOME/.config/rclone/rclone.conf"

echo "Testing an encrypted upload and download…"
TEST=$(mktemp); echo "printflex offsite test $(date -u +%FT%TZ)" > "$TEST"
"$RCLONE" copyto "$TEST" printflex-offsite:setup-test.txt
BACK=$("$RCLONE" cat printflex-offsite:setup-test.txt)
"$RCLONE" deletefile printflex-offsite:setup-test.txt
rm -f "$TEST"
[[ "$BACK" == "printflex offsite test"* ]] || { echo "Round trip failed."; exit 1; }

cat <<MSG

Offsite backups are configured and the encrypted round trip works.

SAVE THESE TWO NOW in your password manager (entry "PrintFlex offsite backup encryption").
They are shown only this once, and the backups cannot be restored without them:

  Bucket:      $BUCKET
  Password:    $PASS
  Salt:        $SALT

Then tell Claude "offsite setup done" and it will switch the nightly backup on.
MSG
