import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  storeTokens,
  courseProductIdFor,
  unmappedCourseCandidates,
  isPaidStatus,
} from "@/lib/bigcommerce";
import {
  notifyReconciliation,
  notifyWatchdogFailed,
} from "@/lib/notify";
import { requireSharedSecret } from "@/lib/require-secret";

// Finds course buyers who paid but never got access.
//
// The watchdog catches a webhook that is switched off, but only after
// BigCommerce has already spent 48 hours failing to deliver — and turning it
// back on replays nothing. Anything lost in that window is invisible unless
// somebody compares paid orders against granted access. This is that
// comparison, run on a schedule instead of after a complaint.
//
// It REPORTS rather than onboards. Emailing customers straight from a cron
// job means one wrong SKU mapping or one bad status assumption sends real
// mail to real people with nobody in the loop. The list is small by nature —
// it should usually be empty — so a human confirming it costs little and
// bounds the damage of a mistake.
//
// It posts even when it finds nothing. A job that only speaks up on bad news
// is indistinguishable from a job that has died, which is precisely the
// failure this exists to catch.

export const dynamic = "force-dynamic";
export const maxDuration = 900;

const DEFAULT_DAYS = 10; // weekly run, with overlap so nothing falls between

// Every paid order costs one request for its line items, and the .com store
// alone books thousands in a ten-day window. Sequentially that overruns any
// request timeout we can set, so the line-item fetches run in a small pool.
// Kept modest on purpose: BigCommerce rate-limits per store, and a
// reconciliation that trips the limit reports nothing at all.
const CONCURRENCY = 8;

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

export async function GET(req: NextRequest) {
  const refused = await requireSharedSecret({
    variable: "CRON_SECRET",
    header: "x-evolve-cron-secret",
    got: req.headers.get("x-evolve-cron-secret"),
    endpoint: "the weekly reconciliation, which returns customers' names and email addresses",
  });
  if (refused) return refused;

  const days = Number(req.nextUrl.searchParams.get("days")) || DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  // One store at a time is available for a manual run, so a store that is
  // slow or erroring can be looked at without waiting for the other two.
  const onlyStore = req.nextUrl.searchParams.get("store");
  const admin = supabaseAdmin();

  // What the platform believes, keyed by email.
  const { data: userPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const userIdByEmail = new Map<string, string>();
  for (const u of userPage?.users ?? []) {
    if (u.email) userIdByEmail.set(u.email.toLowerCase(), u.id);
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

  const missing: {
    store: string;
    order: number;
    date: string;
    email: string;
    name: string;
    productId: number;
  }[] = [];

  // Lines that looked like a course but could not be matched. Reported in
  // the summary rather than alerted on: it posts whether or not anything is
  // wrong, so nothing here can be lost to a throttle.
  const unmatchedLines: {
    store: string;
    order: number;
    productId?: number;
    sku?: string;
    name?: string;
  }[] = [];
  let ordersScanned = 0;
  let courseOrders = 0;
  const storeErrors: string[] = [];

  const stores = Object.entries(storeTokens()).filter(
    ([hash]) => !onlyStore || hash === onlyStore
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

          // Same blind spot as the webhook: a course sold under a SKU we do
          // not know is skipped rather than mis-matched, and silence is how a
          // waiting buyer stays invisible. Collected rather than alerted on,
          // because the summary below is posted unconditionally and can carry
          // every one of them — a throttle inside a ten-day scan would show
          // the first and drop the rest.
          for (const line of unmappedCourseCandidates(lines ?? [], storeHash)) {
            unmatchedLines.push({
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
      await notifyWatchdogFailed({ storeHash, reason: `reconciliation failed — ${reason}` });
    }
  }

  await notifyReconciliation({
    days,
    ordersScanned,
    courseOrders,
    missing,
    unmatched: unmatchedLines,
    storeErrors,
    storesChecked: stores.map(([hash]) => hash),
  });

  return NextResponse.json({
    ok: true,
    days,
    ordersScanned,
    courseOrders,
    missingCount: missing.length,
    missing,
    storeErrors,
  });
}
