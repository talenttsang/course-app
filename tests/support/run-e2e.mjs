// Opt-in entry points. The default `playwright test` config never reaches
// these modes: production smoke and the live admin sign-in each require an
// explicit environment variable, and staging requires a non-production base URL.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
const cli = fileURLToPath(new URL("../../node_modules/@playwright/test/cli.js", import.meta.url));
const PRODUCTION_HOST = "evolve.superhairpieces.com";

function assertStagingBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`E2E_BASE_URL is not an absolute URL (${raw}).`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === PRODUCTION_HOST || host.endsWith(`.${PRODUCTION_HOST}`)) {
    throw new Error(
      `Refusing to run write-path tests against production (${raw}). Point E2E_BASE_URL at a private staging origin.`
    );
  }
}

function launch(args) {
  const child = spawn(process.execPath, [cli, ...args], { stdio: "inherit", env: process.env });
  child.on("exit", (code) => process.exit(code ?? 1));
}

if (mode === "prod") {
  if (process.env.E2E_ALLOW_PROD !== "1") {
    console.error("Refusing to run production smoke. Set E2E_ALLOW_PROD=1 to opt in.");
    console.error("The smoke test is read-only GETs. It does not call cron, webhooks, or onboarding.");
    process.exit(1);
  }
  launch(["test", "--config", "playwright.prod.config.ts", "--project=live-public"]);
} else if (mode === "admin") {
  if (process.env.E2E_ALLOW_PROD !== "1" || process.env.E2E_ALLOW_LIVE_ADMIN !== "1") {
    console.error(
      "Refusing to sign in to production. Set E2E_ALLOW_PROD=1 and E2E_ALLOW_LIVE_ADMIN=1 to run the manual live admin test."
    );
    console.error("This test is not part of CI. Also set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
    process.exit(1);
  }
  launch(["test", "--config", "playwright.admin.config.ts", "--project=live-admin"]);
} else if (mode === "staging") {
  const base = process.env.E2E_BASE_URL?.trim();
  if (!base) {
    console.error("Set E2E_BASE_URL to a private staging origin, for example http://127.0.0.1:8080.");
    console.error("The local dev server is not started. The origin must not be production.");
    process.exit(1);
  }
  try {
    assertStagingBaseUrl(base);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  launch(["test", "--project=local"]);
} else {
  console.error("Usage: node tests/support/run-e2e.mjs <prod|admin|staging>");
  process.exit(1);
}
