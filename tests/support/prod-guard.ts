// Shared by the Playwright configs and the write-path specs. Write-path
// tests have no opt-in that allows the production host. Prod smoke is a
// separate config and still requires E2E_ALLOW_PROD=1.

const PRODUCTION_HOST = "evolve.superhairpieces.com";

export function isProductionBaseUrl(raw: string | undefined | null): boolean {
  if (!raw || !raw.trim()) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return host === PRODUCTION_HOST || host.endsWith(`.${PRODUCTION_HOST}`);
}

export function assertWritePathBaseUrl(raw: string | undefined | null): void {
  if (!raw || !raw.trim()) {
    throw new Error("Refusing to run write-path tests without a base URL.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Refusing to run write-path tests with an unparseable base URL (${raw}).`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing to run write-path tests with base URL ${raw}.`);
  }
  if (isProductionBaseUrl(raw)) {
    throw new Error(
      `Refusing to run write-path tests against production (${raw}). There is no opt-in that points creates, updates, or deletes at https://${PRODUCTION_HOST}.`
    );
  }
}

type Env = { [key: string]: string | undefined };

export function assertProdOptIn(env: Env): void {
  if (env.E2E_ALLOW_PROD !== "1") {
    throw new Error(
      "Refusing to run production tests. Set E2E_ALLOW_PROD=1 to opt in. A bare `npx playwright test` does not target production."
    );
  }
}

export function assertLiveAdminOptIn(env: Env): void {
  assertProdOptIn(env);
  if (env.E2E_ALLOW_LIVE_ADMIN !== "1") {
    throw new Error(
      "Refusing to sign in to production. Set E2E_ALLOW_LIVE_ADMIN=1 to run the manual live admin test. It is not part of CI."
    );
  }
}
