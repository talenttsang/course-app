import { defineConfig, devices } from "@playwright/test";
import { assertProdOptIn } from "./tests/support/prod-guard";

// Read-only GETs against production. Loaded only when E2E_ALLOW_PROD=1.
// There is no webServer, and this file does not register the admin sign-in.
assertProdOptIn(process.env);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "live-public",
      testMatch: /live-public\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "https://evolve.superhairpieces.com",
      },
    },
  ],
});
