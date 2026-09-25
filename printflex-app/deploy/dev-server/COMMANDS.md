# Deploy commands (run from the printflex-app folder on the Mac)

## 1. Sync the code to the server
rsync -az --exclude .git --exclude node_modules --exclude build ./ devteam01@187.52.115.100:/home/devteam01/printflex/

## 2. Prepare the server (one time)
ssh devteam01@187.52.115.100 'bash ~/printflex/deploy/dev-server/server-setup.sh'

## 3. Add the secrets (one time) - paste the API key and secret, save, exit
ssh -t devteam01@187.52.115.100 'nano ~/printflex/.env'

## 4. Deploy (also every future release)
bash deploy/dev-server/deploy.sh

## Afterwards
ssh devteam01@187.52.115.100 pm2 logs printflex-dev
ssh devteam01@187.52.115.100 pm2 restart printflex-dev
