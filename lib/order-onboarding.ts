import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-server";
import { emailOriginOrReason } from "@/lib/origin";
import { sendCourseWelcome } from "@/lib/onboarding";
import { localeForCourses } from "@/lib/i18n";
import { fullNameFromBilling, rememberStudentName } from "@/lib/students";
import { tokenForStore, courseProductIds, isPaidStatus } from "@/lib/bigcommerce";

// Onboards one BigCommerce order: reads it from the store, and if it is paid
// and contains a course, makes sure the buyer has an account, grants every
// course in it and emails them a welcome with a sign-in link.
//
// There is no webhook. Staff run this from the admin "Waiting" page, one
// order at a time, after the reconciliation has listed it. The order is read
// from BigCommerce here rather than taken from the page, so what gets granted
// and who gets emailed is whatever the store says, not whatever was posted.
//
// Idempotent: the email only goes out for course access that is genuinely
// new, so clicking twice never sends a second welcome.

export type OrderOnboardResult =
  | {
      ok: true;
      email: string;
      coursesGranted: string[];
      newAccount: boolean;
      emailed: boolean;
      emailError?: string;
    }
  | { ok: true; skipped: string }
  | { ok: false; error: string };

export async function onboardOrder(opts: {
  storeHash: string;
  orderId: number;
  headers: { get(name: string): string | null };
}): Promise<OrderOnboardResult> {
  const { storeHash, orderId } = opts;

  const accessToken = tokenForStore(storeHash);
  if (!accessToken) {
    return { ok: false, error: `no API token configured for BigCommerce store ${storeHash}` };
  }
  const headers = { "X-Auth-Token": accessToken, Accept: "application/json" };
  const base = `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}`;

  // 1. The order, for the buyer's email and whether it is paid.
  const orderRes = await fetch(base, { headers, cache: "no-store" });
  if (!orderRes.ok) {
    return {
      ok: false,
      error:
        orderRes.status === 401
          ? `the API token for store ${storeHash} is rejected (401) — replace it before onboarding anyone from that store`
          : `could not read order ${orderId} from store ${storeHash} (HTTP ${orderRes.status})`,
    };
  }
  const order = await orderRes.json();

  if (!isPaidStatus(order.status_id)) {
    return { ok: true, skipped: `order is not paid (status ${order.status_id})` };
  }

  const customerEmail = (order.billing_address?.email ?? "").trim().toLowerCase();
  if (!customerEmail) return { ok: false, error: "the order has no billing email" };

  // 2. Its lines. Matched by SKU where we recognise one: product ids are
  //    per-store, so the same course carries a different id on each storefront.
  const productsRes = await fetch(`${base}/products`, { headers, cache: "no-store" });
  if (!productsRes.ok) {
    return { ok: false, error: `could not read the order's products (HTTP ${productsRes.status})` };
  }
  const products = await productsRes.json();
  const lines = Array.isArray(products) ? products : [];
  const purchasedProductIds = courseProductIds(lines, storeHash);

  const admin = supabaseAdmin();

  // 3. Which of those are courses we teach.
  const { data: matchedCourses } = await admin
    .from("courses")
    .select("id, title, bigcommerce_product_id")
    .in("bigcommerce_product_id", purchasedProductIds);

  if (!matchedCourses || matchedCourses.length === 0) {
    return { ok: true, skipped: "none of the order's products is a course" };
  }

  // 4. Find or create the buyer's account.
  const buyerName = fullNameFromBilling(order.billing_address);

  let user = await findUserByEmail(admin, customerEmail);
  const isNewAccount = !user;

  if (!user) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: customerEmail,
      email_confirm: true, // skip email confirmation, they already paid
      ...(buyerName ? { user_metadata: { full_name: buyerName } } : {}),
    });
    if (error || !created.user) {
      return { ok: false, error: `could not create account: ${error?.message ?? "unknown"}` };
    }
    user = created.user;
  }

  // An existing account from before we recorded names still gets one.
  await rememberStudentName(user.id, buyerName);

  // 5. Grant only what they do not already hold, so a second click does not
  //    send a second welcome.
  const { data: existing } = await admin
    .from("purchases")
    .select("course_id")
    .eq("user_id", user.id);

  const alreadyOwned = new Set((existing ?? []).map((p) => p.course_id));
  const newCourses = matchedCourses.filter((c) => !alreadyOwned.has(c.id));

  if (newCourses.length === 0) {
    return { ok: true, skipped: `${customerEmail} already has every course in this order` };
  }

  const { error: insertError } = await admin.from("purchases").upsert(
    newCourses.map((c) => ({
      user_id: user!.id,
      course_id: c.id,
      bigcommerce_order_id: orderId,
    })),
    { onConflict: "user_id,course_id" }
  );
  if (insertError) {
    return { ok: false, error: `could not grant access: ${insertError.message}` };
  }

  // 6. Welcome them in. Access is already granted at this point, so a mail
  //    failure is reported alongside the success rather than replacing it.
  const where = await emailOriginOrReason(opts.headers, "a store purchase welcome");
  const { sent: emailed, reason: emailError } = where.origin
    ? await sendCourseWelcome({
        to: customerEmail,
        courseTitles: newCourses.map((c) => c.title),
        origin: where.origin,
        locale: localeForCourses(newCourses.map((c) => c.bigcommerce_product_id)),
        userId: user.id,
      })
    : { sent: false as const, reason: where.reason };

  return {
    ok: true,
    email: customerEmail,
    coursesGranted: newCourses.map((c) => c.title),
    newAccount: isNewAccount,
    emailed,
    ...(emailError ? { emailError } : {}),
  };
}

// listUsers() is paginated and defaults to the first 50 accounts. Scanning
// only page one would silently miss returning customers once the school
// passes 50 students, and createUser would then fail on the duplicate.
async function findUserByEmail(
  admin: ReturnType<typeof supabaseAdmin>,
  email: string
): Promise<User | null> {
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`could not list users: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) break; // last page
  }
  return null;
}
