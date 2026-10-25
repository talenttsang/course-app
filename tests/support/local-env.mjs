// Environment for the in-memory stand-in. Real SMTP, Google Chat, and
// BigCommerce credentials are blanked, then the preload stops `.env.local`
// from filling them back in. The Supabase URL is the local mock, never a
// hosted project.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { isStandinControlledKey } = require("./lock-local-env.cjs");

export const lockScriptPath = fileURLToPath(new URL("./lock-local-env.cjs", import.meta.url));

const TEST_WEBHOOK_SECRET = "test-webhook-secret";
const TEST_CRON_SECRET = "test-cron-secret";
const TEST_SERVICE_ROLE = "test-service-role";
const TEST_ANON_KEY = "test-anon-key";

/** @returns {Record<string, string>} */
export function buildLocalEnv(parent, { port, appPort }) {
  const env = {};
  for (const [key, value] of Object.entries(parent || {})) {
    if (typeof value === "string") env[key] = value;
  }
  for (const key of Object.keys(env)) {
    if (isStandinControlledKey(key)) env[key] = "";
  }

  env.NEXT_TELEMETRY_DISABLED = "1";
  env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`;
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = TEST_ANON_KEY;
  env.SUPABASE_SERVICE_ROLE_KEY = TEST_SERVICE_ROLE;
  env.ADMIN_EMAILS = "staff@example.test";
  env.BIGCOMMERCE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  env.CRON_SECRET = TEST_CRON_SECRET;
  env.PUBLIC_ORIGIN = `http://127.0.0.1:${appPort}`;
  env.EVOLVE_LOCK_LOCAL_ENV = "1";
  env.SMTP_HOST = "";
  env.SMTP_PORT = "";
  env.SMTP_USER = "";
  env.SMTP_PASS = "";
  env.SMTP_FROM = "";
  env.GOOGLE_CHAT_WEBHOOK = "";
  env.BIGCOMMERCE_STORES = "";
  env.BIGCOMMERCE_STORE_HASH = "";
  env.BIGCOMMERCE_ACCESS_TOKEN = "";

  const leaked = [];
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (/evolve\.superhairpieces\.com/i.test(value) || /\.supabase\.co\b/i.test(value)) {
      leaked.push(key);
    }
  }
  if (leaked.length > 0) {
    throw new Error(
      `Refusing to boot the local stand-in. These variables still point at production or a hosted Supabase project: ${leaked.sort().join(", ")}`
    );
  }
  return env;
}
