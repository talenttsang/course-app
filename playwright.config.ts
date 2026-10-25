import { defineConfig, devices } from "@playwright/test";
import { assertWritePathBaseUrl } from "./tests/support/prod-guard";

// Write-path suite only. Production smoke lives in playwright.prod.config.ts
// and the live admin sign-in lives in playwright.admin.config.ts. Neither is
// selected by `npx playwright test` or `npm run test:e2e:all`.
const external = process.env.E2E_BASE_URL?.trim() ?? "";
const baseURL = external || "http://127.0.0.1:3000";
assertWritePathBaseUrl(baseURL);

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
  webServer: external
    ? undefined
    : {
        command: "node tests/support/start-local.mjs",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: false,
        timeout: 180_000,
      },
  projects: [
    {
      name: "local",
      testMatch: /local\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL },
    },
  ],
});
