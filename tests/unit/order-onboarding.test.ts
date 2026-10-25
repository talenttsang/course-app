import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ supabase: 0 }));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: () => {
    calls.supabase += 1;
    throw new Error("Supabase should not be reached for an order that is not onboarded");
  },
  publicOrigin: () => "http://127.0.0.1:3000",
}));

import { onboardOrder } from "@/lib/order-onboarding";

const ORIGINAL = { ...process.env };
const noHeaders = { get: () => null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls.supabase = 0;
  process.env = { ...ORIGINAL };
  delete process.env.BIGCOMMERCE_STORE_HASH;
  delete process.env.BIGCOMMERCE_ACCESS_TOKEN;
  process.env.BIGCOMMERCE_STORES = JSON.stringify({ teststore: "test-token" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL };
});

describe("onboarding an order from the Waiting page", () => {
  it("refuses a store we hold no token for without calling anything", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("unit tests must not call the network");
    });
    const result = await onboardOrder({ storeHash: "otherstore", orderId: 1, headers: noHeaders });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("otherstore") });
    expect(calls.supabase).toBe(0);
  });

  it("says plainly when the store token is rejected", async () => {
    vi.stubGlobal("fetch", async () => json({}, 401));
    const result = await onboardOrder({ storeHash: "teststore", orderId: 7, headers: noHeaders });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/401/);
    expect(calls.supabase).toBe(0);
  });

  it("skips an order that is not paid, before creating anyone", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api.bigcommerce.com/stores/teststore/v2/orders/8");
      return json({ id: 8, status_id: 7, billing_address: { email: "buyer@example.test" } });
    });
    const result = await onboardOrder({ storeHash: "teststore", orderId: 8, headers: noHeaders });
    expect(result).toEqual({ ok: true, skipped: expect.stringContaining("not paid") });
    expect(calls.supabase).toBe(0);
  });
});
