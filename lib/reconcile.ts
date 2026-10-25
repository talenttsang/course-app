import { supabaseAdmin } from "@/lib/supabase-server";
import {
  storeTokens,
  courseProductIdFor,
  unmappedCourseCandidates,
  isPaidStatus,
} from "@/lib/bigcommerce";

// Finds course buyers who paid but never got access.
//
// With no order webhook, every sale lands here first: staff open the admin
// "Waiting" page, which runs this, and onboard each buyer it lists. It only
// reads. Emailing customers straight from a scan means one wrong SKU mapping
// or one bad status assumption sends real mail to real people with nobody in
// the loop, so a human confirms every row.

export const DEFAULT_DAYS = 10;
export const MAX_DAYS = 60;

// Every paid order costs one request for its line items, and the .com store
// alone books thousands in a ten-day window. Sequentially that is minutes of
// waiting, so the line-item fetches run in a small pool. Kept modest on
// purpose: BigCommerce rate-limits per store, and a scan that trips the limit
// reports nothing at all.
const CONCURRENCY = 8;

export type MissingBuyer = {
  store: string;
  order: number;
  date: string;
  email: string;
  name: string;
  productId: number;
};

export type UnmatchedLine = {
  store: string;
  order: number;
  productId?: number;
  sku?: string;
  name?: string;
};

export type Reconciliation = {
  days: number;
  ordersScanned: number;
  courseOrders: number;
  missing: MissingBuyer[];
  unmatched: UnmatchedLine[];
  storeErrors: string[];
  storesChecked: string[];
};

async function bcFetch(url: string, headers: Record<string, string>) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.status !== 429 || attempt >= 3) return res;
    const retryAfter = Number(res.headers.get("x-rate-limit-time-reset-ms")) || 5000;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 20_000)));
  }
}

async function pooled<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await work(items[i]);
    }
  });
  await Promise.all(runners);
}

export async function reconcile(opts: { days?: number; store?: string | null } = {}): Promise<Reconciliation> {
  const days = Math.min(Math.max(Math.floor(opts.days || DEFAULT_DAYS), 1), MAX_DAYS);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const admin = supabaseAdmin();

  // What the platform believes, keyed by email. Every page: a buyer whose
  // account sits past the first page would otherwise be reported as missing
  // a course they already have.
  const userIdByEmail = new Map<string, string>();
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`could not list users: ${error.message}`);
    for (const u of data?.users ?? []) {
      if (u.email) userIdByEmail.set(u.email.toLowerCase(), u.id);
    }
    if ((data?.users ?? []).length < perPage) break;
  }

  const { data: purchases } = await admin
    .from("purchases")
    .select("user_id, courses(bigcommerce_product_id)");
  const ownedByUser = new Map<string, Set<number>>();
  for (const row of purchases ?? []) {
    const raw = (row as { courses: unknown }).courses;
    const course = (Array.isArray(raw) ? raw[0] : raw) as
      | { bigcommerce_product_id: number }
      | null;
    if (!course) continue;
    const set = ownedByUser.get(row.user_id as string) ?? new Set<number>();
    set.add(course.bigcommerce_product_id);
    ownedByUser.set(row.user_id as string, set);
  }

  // Read once rather than per matching line: the set is four rows long and
  // never changes mid-run.
  const { data: courseRows } = await admin.from("courses").select("bigcommerce_product_id");
  const knownCourses = new Set<number>(
    (courseRows ?? []).map((c) => (c as { bigcommerce_product_id: number }).bigcommerce_product_id)
  );

  const missing: MissingBuyer[] = [];
  // Lines that looked like a course but could not be matched. Each is either
  // an ordinary product sharing an id with a course, or a course whose SKU has
  // changed — in which case that buyer has no access and is not in `missing`.
  const unmatched: UnmatchedLine[] = [];
  let ordersScanned = 0;
  let courseOrders = 0;
  const storeErrors: string[] = [];

  const stores = Object.entries(storeTokens()).filter(
    ([hash]) => !opts.store || hash === opts.store
  );

  for (const [storeHash, token] of stores) {
    const headers = { "X-Auth-Token": token, Accept: "application/json" };
    const base = `https://api.bigcommerce.com/stores/${storeHash}`;

    try {
      for (let page = 1; page <= 40; page++) {
        const res = await bcFetch(
          `${base}/v2/orders?min_date_created=${encodeURIComponent(since)}` +
            `&limit=250&page=${page}&sort=id:asc`,
          headers
        );
        if (res.status === 204) break;
        if (!res.ok) throw new Error(`orders ${res.status}`);
        const orders = (await res.json()) as Record<string, unknown>[];
        if (!orders?.length) break;

        ordersScanned += orders.length;
        // Unpaid orders are not a problem; skip before spending a request.
        const paid = orders.filter((o) => isPaidStatus(o.status_id as number));

        await pooled(paid, CONCURRENCY, async (order) => {
          const lineRes = await bcFetch(`${base}/v2/orders/${order.id}/products`, headers);
          if (lineRes.status === 204 || !lineRes.ok) return;
          const lines = (await lineRes.json()) as { product_id?: number; sku?: string }[];

          const billing = (order.billing_address ?? {}) as Record<string, string>;
          const email = (billing.email ?? "").toLowerCase();

          for (const line of unmappedCourseCandidates(lines ?? [], storeHash)) {
            unmatched.push({
              store: storeHash,
              order: order.id as number,
              productId: line.product_id,
              sku: line.sku,
              name: (line as { name?: string }).name,
            });
          }

          for (const line of lines ?? []) {
            const productId = courseProductIdFor(line, storeHash);
            if (productId === null) continue;
            if (!knownCourses.has(productId)) continue; // ours, but not a course

            courseOrders++;
            const userId = email ? userIdByEmail.get(email) : undefined;
            const hasAccess = Boolean(userId && ownedByUser.get(userId)?.has(productId));
            if (!hasAccess) {
              missing.push({
                store: storeHash,
                order: order.id as number,
                date: String(order.date_created ?? ""),
                email,
                name: `${billing.first_name ?? ""} ${billing.last_name ?? ""}`.trim(),
                productId,
              });
            }
          }
        });

        if (orders.length < 250) break;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      storeErrors.push(`${storeHash}: ${reason}`);
    }
  }

  // Newest first. BigCommerce dates are RFC 2822 ("Tue, 20 Oct 2026 …"), so
  // they sort as dates, not strings.
  missing.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));

  return {
    days,
    ordersScanned,
    courseOrders,
    missing,
    unmatched,
    storeErrors,
    storesChecked: stores.map(([hash]) => hash),
  };
}
