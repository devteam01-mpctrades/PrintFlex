// pm2 process for PRODUCTION (app.printflex.mpctrades.com). Loads /home/devteam01/printflex-prod/.env so secrets stay out of this file.
const fs = require("node:fs");
const path = require("node:path");

const root = "/home/devteam01/printflex-prod";
const node24 = "/home/devteam01/node24/bin";
const env = { NODE_ENV: "production", PORT: "3012", PATH: `${node24}:${process.env.PATH ?? ""}` };
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !line.trim().startsWith("#")) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

module.exports = {
  apps: [
    {
      name: "printflex-prod",
      cwd: root,
      script: `${node24}/npm`,
      interpreter: `${node24}/node`,
      args: "start",
      env,
      max_memory_restart: "700M",
      time: true,
    },
  ],
};
