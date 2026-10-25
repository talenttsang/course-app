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
            throw new Error("listUsers should not run for an unauthorised call");
          },
        },
      },
    };
  },
  publicOrigin: () => "http://127.0.0.1:3000",
}));

import { POST as onboard } from "@/app/api/admin/onboard/route";
import { GET as callback } from "@/app/auth/callback/route";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  calls.supabase = 0;
  process.env = { ...ORIGINAL };
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
