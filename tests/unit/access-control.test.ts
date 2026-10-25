import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const calls = vi.hoisted(() => ({ supabase: 0 }));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: () => {
    calls.supabase += 1;
    const result = { data: null, error: null, count: 0 };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const method of ["select", "eq", "in", "order", "limit", "insert", "update", "upsert", "delete"]) {
      chain[method] = self;
    }
    chain.maybeSingle = async () => result;
    chain.single = async () => result;
    chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
    return {
      from: () => chain,
      auth: {
        getUser: async () => ({ data: { user: null }, error: { message: "no session" } }),
        admin: {
          listUsers: async () => {
            throw new Error("listUsers should not run for an unauthorised cron call");
          },
        },
      },
    };
  },
  publicOrigin: () => "http://127.0.0.1:3000",
}));

vi.mock("@/lib/notify", () => ({
  notifyOnboardFailed: async () => {},
  notifyOnboarded: async () => {},
  notifyReconciliation: async () => {},
  notifyWatchdogFailed: async () => {},
  notifyWebhookRepaired: async () => {},
}));

import { POST as webhook } from "@/app/api/webhooks/bigcommerce/route";
import { POST as onboard } from "@/app/api/admin/onboard/route";
import { GET as reconcile } from "@/app/api/cron/reconcile/route";
import { GET as watchdog } from "@/app/api/cron/webhook-watchdog/route";
import { GET as callback } from "@/app/auth/callback/route";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  calls.supabase = 0;
  process.env = { ...ORIGINAL };
  delete process.env.BIGCOMMERCE_WEBHOOK_SECRET;
  delete process.env.CRON_SECRET;
  delete process.env.BIGCOMMERCE_STORE_HASH;
  delete process.env.BIGCOMMERCE_ACCESS_TOKEN;
  delete process.env.BIGCOMMERCE_STORES;
  delete process.env.ADMIN_EMAILS;
  delete process.env.PUBLIC_ORIGIN;
  vi.stubGlobal("fetch", () => {
    throw new Error("unit tests must not call the network");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL };
});

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("webhook authorisation", () => {
  it("rejects a missing or wrong secret when one is configured", async () => {
    process.env.BIGCOMMERCE_WEBHOOK_SECRET = "expected-secret";
    const missing = await webhook(
      jsonRequest("https://evolve.example/api/webhooks/bigcommerce", { data: { id: 1 } })
    );
    expect(missing.status).toBe(401);
    const wrong = await webhook(
      jsonRequest(
        "https://evolve.example/api/webhooks/bigcommerce",
        { data: { id: 1 } },
        { "x-evolve-webhook-secret": "nope" }
      )
    );
    expect(wrong.status).toBe(401);
    expect(calls.supabase).toBe(0);
  });

  it("returns 400 for a payload without an order id and does not call BigCommerce", async () => {
    process.env.BIGCOMMERCE_WEBHOOK_SECRET = "expected-secret";
    const res = await webhook(
      jsonRequest(
        "https://evolve.example/api/webhooks/bigcommerce",
        {},
        { "x-evolve-webhook-secret": "expected-secret" }
      )
    );
    expect(res.status).toBe(400);
    expect(calls.supabase).toBe(0);
  });

  // KNOWN BUG: with the secret unset, webhookSecretOk() returns true and the
  // route keeps going. An empty body happens to stop at "missing order id"
  // (400) before any order is read. The correct behaviour is 401.
  it.fails("BUG-WEBHOOK: an unset webhook secret must still reject the call", async () => {
    const res = await webhook(jsonRequest("https://evolve.example/api/webhooks/bigcommerce", {}));
    expect(res.status).toBe(401);
  });
});

describe("manual onboard authorisation", () => {
  it("rejects a missing bearer token and a token that is not an admin", async () => {
    const missing = await onboard(
      jsonRequest("https://evolve.example/api/admin/onboard", { email: "a@b.co", productId: 1 })
    );
    expect(missing.status).toBe(401);

    const stranger = await onboard(
      jsonRequest(
        "https://evolve.example/api/admin/onboard",
        { email: "a@b.co", productId: 1 },
        { authorization: "Bearer some-student-token" }
      )
    );
    expect(stranger.status).toBe(403);
  });
});

describe("cron authorisation", () => {
  it("rejects a wrong cron secret before reading orders", async () => {
    process.env.CRON_SECRET = "expected-cron";
    const reconcileRes = await reconcile(
      new NextRequest("https://evolve.example/api/cron/reconcile", {
        headers: { "x-evolve-cron-secret": "nope" },
      })
    );
    const watchdogRes = await watchdog(
      new NextRequest("https://evolve.example/api/cron/webhook-watchdog")
    );
    expect(reconcileRes.status).toBe(401);
    expect(watchdogRes.status).toBe(401);
    expect(calls.supabase).toBe(0);
  });

  // KNOWN BUG: both cron routes skip the check when CRON_SECRET is empty,
  // so the URL is public. The watchdog can register BigCommerce webhooks.
  it.fails("BUG-CRON: reconcile refuses to run when CRON_SECRET is unset", async () => {
    const res = await reconcile(new NextRequest("https://evolve.example/api/cron/reconcile"));
    expect(res.status).toBe(401);
  });

  it.fails("BUG-CRON: the webhook watchdog refuses to run when CRON_SECRET is unset", async () => {
    const res = await watchdog(new NextRequest("https://evolve.example/api/cron/webhook-watchdog"));
    expect(res.status).toBe(401);
  });
});

describe("sign-in redirect", () => {
  it("sends a failed callback to the login page on our host", async () => {
    const res = await callback(
      new NextRequest("https://evolve.example/auth/callback?next=//evil.example", {
        headers: {
          "x-forwarded-host": "evolve.example",
          "x-forwarded-proto": "https",
        },
      })
    );
    const location = res.headers.get("location") || "";
    expect(location).toContain("/login?error=link");
    expect(location).not.toContain("evil.example");
  });
});
