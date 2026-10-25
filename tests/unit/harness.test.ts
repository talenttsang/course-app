import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLocalEnv, lockScriptPath } from "../support/local-env.mjs";
import { redactEnvFile } from "../support/lock-local-env.cjs";
import {
  assertLiveAdminOptIn,
  assertProdOptIn,
  assertWritePathBaseUrl,
  isProductionBaseUrl,
} from "../support/prod-guard";

describe("production host guard", () => {
  it("recognises the production host and not a lookalike", () => {
    expect(isProductionBaseUrl("https://evolve.superhairpieces.com")).toBe(true);
    expect(isProductionBaseUrl("https://evolve.superhairpieces.com/login")).toBe(true);
    expect(isProductionBaseUrl("https://EVOLVE.superhairpieces.com")).toBe(true);
    expect(isProductionBaseUrl("https://user:pass@evolve.superhairpieces.com/admin")).toBe(true);
    expect(isProductionBaseUrl("https://www.evolve.superhairpieces.com")).toBe(true);
    expect(isProductionBaseUrl("http://127.0.0.1:3000")).toBe(false);
    expect(isProductionBaseUrl("http://localhost:8080")).toBe(false);
    expect(isProductionBaseUrl("https://evolve.superhairpieces.com.evil.test")).toBe(false);
    expect(isProductionBaseUrl("https://staging.example")).toBe(false);
    expect(isProductionBaseUrl("not a url")).toBe(false);
  });

  it("refuses write-path base URLs on the production host", () => {
    expect(() => assertWritePathBaseUrl("http://127.0.0.1:8080")).not.toThrow();
    expect(() => assertWritePathBaseUrl("http://localhost:8080")).not.toThrow();
    expect(() => assertWritePathBaseUrl("https://evolve.superhairpieces.com")).toThrow(/production/);
    expect(() => assertWritePathBaseUrl("")).toThrow(/base URL/);
  });

  it("requires an explicit opt-in before production projects can load", () => {
    expect(() => assertProdOptIn({ E2E_ALLOW_PROD: "1" })).not.toThrow();
    expect(() => assertProdOptIn({})).toThrow(/E2E_ALLOW_PROD/);
    expect(() => assertProdOptIn({ E2E_ALLOW_PROD: "0" })).toThrow(/E2E_ALLOW_PROD/);
    expect(() =>
      assertLiveAdminOptIn({ E2E_ALLOW_PROD: "1", E2E_ALLOW_LIVE_ADMIN: "1" })
    ).not.toThrow();
    expect(() => assertLiveAdminOptIn({ E2E_ALLOW_PROD: "1" })).toThrow(/E2E_ALLOW_LIVE_ADMIN/);
    expect(() => assertLiveAdminOptIn({ E2E_ALLOW_LIVE_ADMIN: "1" })).toThrow(/E2E_ALLOW_PROD/);
  });
});

describe("local stand-in environment", () => {
  it("blanks mail, chat, and store credentials that arrived in the parent environment", () => {
    const env = buildLocalEnv(
      {
        PATH: "/usr/bin",
        SMTP_HOST: "smtp.gmail.com",
        SMTP_PORT: "587",
        SMTP_USER: "sales@superhairpieces.com",
        SMTP_PASS: "real-password",
        SMTP_FROM: "sales@superhairpieces.com",
        GOOGLE_CHAT_WEBHOOK: "https://chat.googleapis.com/v1/spaces/AAA/messages?key=real",
        BIGCOMMERCE_STORES: JSON.stringify({ gmosz3ja: "real-token" }),
        BIGCOMMERCE_STORE_HASH: "gmosz3ja",
        BIGCOMMERCE_ACCESS_TOKEN: "real-token",
        NEXT_PUBLIC_SUPABASE_URL: "https://exampleproject.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "real-anon",
        SUPABASE_SERVICE_ROLE_KEY: "real-service-role",
        PUBLIC_ORIGIN: "https://evolve.superhairpieces.com",
        ADMIN_EMAILS: "real-staff@example.com",
      },
      { port: 54321, appPort: 3000 }
    );
    expect(env.SMTP_HOST).toBe("");
    expect(env.SMTP_PASS).toBe("");
    expect(env.SMTP_USER).toBe("");
    expect(env.GOOGLE_CHAT_WEBHOOK).toBe("");
    expect(env.BIGCOMMERCE_STORES).toBe("");
    expect(env.BIGCOMMERCE_STORE_HASH).toBe("");
    expect(env.BIGCOMMERCE_ACCESS_TOKEN).toBe("");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("test-service-role");
    expect(env.PUBLIC_ORIGIN).toBe("http://127.0.0.1:3000");
    expect(env.ADMIN_EMAILS).toBe("staff@example.test");
    expect(env.EVOLVE_LOCK_LOCAL_ENV).toBe("1");
  });

  it("refuses to boot when some other variable still points at production", () => {
    expect(() =>
      buildLocalEnv(
        { PATH: "/usr/bin", NOTES: "https://evolve.superhairpieces.com" },
        { port: 54321, appPort: 3000 }
      )
    ).toThrow(/NOTES/);
    expect(() =>
      buildLocalEnv(
        { PATH: "/usr/bin", OTHER_URL: "https://abc.supabase.co" },
        { port: 54321, appPort: 3000 }
      )
    ).toThrow(/OTHER_URL/);
  });

  it("drops stand-in secrets out of env file text", () => {
    const redacted = redactEnvFile(
      [
        "SMTP_HOST=smtp.gmail.com",
        "SMTP_PASS=secret",
        'GOOGLE_CHAT_WEBHOOK="https://chat.googleapis.com/v1/spaces/x"',
        "BIGCOMMERCE_STORES={\"store\":\"token\"}",
        "BIGCOMMERCE_ACCESS_TOKEN=token",
        "export NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co",
        "UNRELATED_PRESENT=yes",
      ].join("\n")
    );
    expect(redacted).not.toContain("smtp.gmail.com");
    expect(redacted).not.toContain("chat.googleapis.com");
    expect(redacted).not.toContain("supabase.co");
    expect(redacted).not.toContain("token");
    expect(redacted).toContain("UNRELATED_PRESENT=yes");
  });

  it("does not let Next load real mail, chat, or store values from .env.local", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "evolve-env-"));
    writeFileSync(
      path.join(dir, ".env.local"),
      [
        "SMTP_HOST=smtp.gmail.com",
        "SMTP_PASS=super-secret",
        "GOOGLE_CHAT_WEBHOOK=https://chat.googleapis.com/v1/spaces/AAA/messages?key=real",
        'BIGCOMMERCE_STORES={"store":"real-token"}',
        "BIGCOMMERCE_STORE_HASH=realhash",
        "BIGCOMMERCE_ACCESS_TOKEN=real-token",
        "UNRELATED_PRESENT=yes",
        "",
      ].join("\n")
    );
    const script = `
      const { loadEnvConfig } = require("@next/env");
      loadEnvConfig(process.env.DIR, true);
      console.log(JSON.stringify({
        smtp: process.env.SMTP_HOST || "",
        pass: process.env.SMTP_PASS || "",
        chat: process.env.GOOGLE_CHAT_WEBHOOK || "",
        stores: process.env.BIGCOMMERCE_STORES || "",
        hash: process.env.BIGCOMMERCE_STORE_HASH || "",
        token: process.env.BIGCOMMERCE_ACCESS_TOKEN || "",
        unrelated: process.env.UNRELATED_PRESENT || "",
      }));
    `;
    const env = buildLocalEnv(
      {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "",
        SMTP_HOST: "smtp.gmail.com",
        SMTP_PASS: "super-secret",
        GOOGLE_CHAT_WEBHOOK: "https://chat.googleapis.com/v1/spaces/AAA/messages?key=real",
        BIGCOMMERCE_STORES: "{\"store\":\"real-token\"}",
        BIGCOMMERCE_ACCESS_TOKEN: "real-token",
      },
      { port: 54321, appPort: 3000 }
    );
    const childEnv: NodeJS.ProcessEnv = {
      ...env,
      DIR: dir,
      NODE_ENV: "development",
      NODE_OPTIONS: `--require ${lockScriptPath}`,
    };
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: process.cwd(),
      env: childEnv,
      encoding: "utf8",
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const loaded = JSON.parse(result.stdout.trim().split("\n").pop() || "{}");
    expect(loaded.smtp).toBe("");
    expect(loaded.pass).toBe("");
    expect(loaded.chat).toBe("");
    expect(loaded.stores).toBe("");
    expect(loaded.hash).toBe("");
    expect(loaded.token).toBe("");
    expect(loaded.unrelated).toBe("yes");
  });
});

describe("default commands stay off production", () => {
  it("npm scripts and the default Playwright config do not select live projects", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:e2e"]).toContain("--project=local");
    expect(pkg.scripts["test:e2e:all"]).toContain("--project=local");
    expect(pkg.scripts["test:e2e:all"]).not.toContain("live");
    expect(pkg.scripts["test:e2e:prod"]).toContain("run-e2e.mjs prod");
    expect(pkg.scripts["test:e2e:live-admin"]).toContain("run-e2e.mjs admin");
    expect(pkg.scripts["test:e2e:staging"]).toContain("run-e2e.mjs staging");

    const config = readFileSync("playwright.config.ts", "utf8");
    expect(config).not.toContain("live-public");
    expect(config).not.toContain("live-admin");
    expect(config).not.toContain("evolve.superhairpieces.com");
  });

  it("CI runs the local suite and does not target production", () => {
    const yaml = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(yaml).toContain("pull_request:");
    expect(yaml).toContain("npm test");
    expect(yaml).toContain("npm run lint");
    expect(yaml).toContain("npm run typecheck");
    expect(yaml).toContain("npm run test:e2e");
    expect(yaml).not.toContain("superhairpieces.com");
    expect(yaml).not.toContain("test:e2e:prod");
    expect(yaml).not.toContain("test:e2e:live");
    expect(yaml).not.toMatch(/gcloud|cloudbuild|cloud run/i);
  });
});
