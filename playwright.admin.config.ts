import { defineConfig, devices } from "@playwright/test";
import { assertLiveAdminOptIn } from "./tests/support/prod-guard";

// Manual production sign-in. CI does not load this file. It still refuses to
// start unless both opt-in variables are set, and the spec skips without them.
assertLiveAdminOptIn(process.env);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "live-admin",
      testMatch: /live-admin\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "https://evolve.superhairpieces.com",
        screenshot: "off",
        trace: "off",
        video: "off",
      },
    },
  ],
});
