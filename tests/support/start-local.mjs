// Boots the in-memory Supabase stand-in and `next dev` for Playwright.
// Credentials here are fake local accounts, never production ones.
// SMTP, Google Chat, and BigCommerce store credentials from the shell or
// from .env.local are blanked before the app starts.

import { spawn } from "node:child_process";
import { createMockServer } from "./mock-supabase.mjs";
import { buildLocalEnv, lockScriptPath } from "./local-env.mjs";

const port = Number(process.env.MOCK_SUPABASE_PORT || 54321);
const appPort = Number(process.env.PORT || 3000);

let env;
try {
  env = buildLocalEnv(process.env, { port, appPort });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
env.NODE_OPTIONS = [env.NODE_OPTIONS, `--require ${lockScriptPath}`].filter(Boolean).join(" ");

const mock = createMockServer();
await new Promise((resolve, reject) => {
  mock.once("error", reject);
  mock.listen(port, "127.0.0.1", resolve);
});
console.log(`[local] mock supabase on 127.0.0.1:${port}`);

const child = spawn("npx", ["next", "dev", "-H", "127.0.0.1", "-p", String(appPort)], {
  stdio: "inherit",
  env,
});

function shutdown() {
  child.kill("SIGTERM");
  mock.close();
}

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
child.on("exit", (code) => {
  mock.close();
  process.exit(code ?? 0);
});
