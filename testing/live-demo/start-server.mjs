// Starts the Next.js app for the live browser tests with the repo-root .env (mail / vercel keys are NOT passed, so
// no real e-mail can be sent) and the app URL pointing at localhost. Secrets are never printed.
//
//   node testing/live-demo/start-server.mjs [--mode dev|start] [--port 3100] [--bad-key] [--fetch-log FILE]
//
//   --bad-key        replaces GOOGLE_MAPS_API_KEY with a recognisable fake ("provider failure" simulation: the
//                    string must then never appear in any HTML / action response / server log).
//   --fetch-log FILE preloads support/fetch-logger.cjs: every outgoing server-side request to Supabase is logged
//                    as {method, path, bearer: anon|service|user|none} (no key values) to FILE.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const mode = arg("--mode", "dev");
const port = arg("--port", "3100");
const env = { ...process.env };
for (const l of readFileSync(path.resolve(here, "../../.env"), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m && !/^(BREVO_|VERCEL_|EMAIL_FROM)/.test(m[1])) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
if (process.argv.includes("--bad-key")) env.GOOGLE_MAPS_API_KEY = "AIzaInvalidKeyForOutageSimulation";
env.NEXT_PUBLIC_APP_URL = `http://localhost:${port}`;
if (process.argv.includes("--fetch-log")) {
  env.FETCH_LOG_FILE = arg("--fetch-log");
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --require=${path.join(here, "support", "fetch-logger.cjs").replace(/\\/g, "/")}`.trim();
}
const child = spawn("npx", ["next", mode, "-p", port], { cwd: path.resolve(here, "../../apps/web"), env, shell: true, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
