import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOTAL = 1002;
const HAS_ACCESS_INDEX = 1000;
const NO_ACCESS_INDEX = 1001;

function usersFor(page: number, perPage: number) {
  const start = (page - 1) * perPage;
  const users: { id: string; email: string }[] = [];
  for (let i = start; i < Math.min(start + perPage, TOTAL); i++) {
    if (i === HAS_ACCESS_INDEX) users.push({ id: "user-has", email: "has-access@example.test" });
    else if (i === NO_ACCESS_INDEX) users.push({ id: "user-none", email: "no-access@example.test" });
    else users.push({ id: `user-${i}`, email: `user-${i}@example.test` });
  }
  return users;
}

const seen = vi.hoisted(() => ({ pages: [] as { page: number; perPage: number }[] }));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: () => ({
    auth: {
      admin: {
        listUsers: async (args: { page?: number; perPage?: number } = {}) => {
          const page = args.page ?? 1;
          const perPage = args.perPage ?? 50;
          seen.pages.push({ page, perPage });
          return { data: { users: usersFor(page, perPage) }, error: null };
        },
      },
    },
    from: (table: string) => {
      const data =
        table === "purchases"
          ? [{ user_id: "user-has", courses: { bigcommerce_product_id: 3463 } }]
          : table === "courses"
            ? [{ bigcommerce_product_id: 3463 }]
            : null;
      if (!data) throw new Error(`unexpected table ${table}`);
      const api = {
        select() {
          return api;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  }),
  publicOrigin: () => "http://127.0.0.1:3000",
}));

import { reconcile } from "@/lib/reconcile";

const ORIGINAL = { ...process.env };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  seen.pages = [];
  process.env = { ...ORIGINAL };
  delete process.env.BIGCOMMERCE_STORE_HASH;
  delete process.env.BIGCOMMERCE_ACCESS_TOKEN;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PASS;
  process.env.BIGCOMMERCE_STORES = JSON.stringify({ teststore: "test-token" });
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.startsWith("https://api.bigcommerce.com/")) {
      throw new Error(`unit tests must not call the network: ${url}`);
    }
    if (url.includes("/products")) {
      return json([{ product_id: 3463, sku: "academystarter" }]);
    }
    if (url.includes("/v2/orders?")) {
      return json([
        {
          id: 501,
          status_id: 11,
          date_created: new Date().toISOString(),
          billing_address: { email: "has-access@example.test", first_name: "Has", last_name: "Access" },
        },
        {
          id: 502,
          status_id: 11,
          date_created: new Date().toISOString(),
          billing_address: { email: "no-access@example.test", first_name: "No", last_name: "Access" },
        },
      ]);
    }
    throw new Error(`unexpected BigCommerce url ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL };
});

async function runReconcile() {
  return reconcile();
}

describe("reconciliation pagination", () => {
  it("reports a paid buyer past the first page who was never granted the course", async () => {
    const body = await runReconcile();
    expect(body.missing.map((row) => row.email)).toContain("no-access@example.test");
  });

  // The buyer on the second page already owns the course. Reading only page
  // one used to report them as missing; dropping unknown emails instead
  // would hide the buyer who really has no access.
  it("pages through every auth user", async () => {
    const body = await runReconcile();
    const emails = body.missing.map((row) => row.email);
    expect(emails).not.toContain("has-access@example.test");
    expect(emails).toContain("no-access@example.test");
  });
});
