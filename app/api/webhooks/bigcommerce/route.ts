import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-server";
import { emailOriginOrReason } from "@/lib/origin";
import { sendCourseWelcome } from "@/lib/onboarding";
import { localeForCourses } from "@/lib/i18n";
import {
  notifyOnboarded,
  notifyOnboardFailed,
  notifyOnce,
  notifyUnmappedCourseSku,
  notifyConfigProblem,
} from "@/lib/notify";
import { fullNameFromBilling, rememberStudentName } from "@/lib/students";
import {
  storeHashFromProducer,
  tokenForStore,
  courseProductIds,
  unmappedCourseCandidates,
  candidateKey,
  catalogueStoreHash,
  catalogueStoreIsConfigured,
  isPaidStatus,
} from "@/lib/bigcommerce";
import { requireSharedSecret } from "@/lib/require-secret";

// Registered on each storefront against store/order/statusUpdated, pointing
// at https://evolve.superhairpieces.com/api/webhooks/bigcommerce.
//
// One endpoint serves every store. BigCommerce stamps each delivery with the
// store it came from, and the credentials for that store are looked up from
// there — a token for the wrong store 404s on every order.
//
// BigCommerce only tells us "an order changed" — it doesn't send the
// purchased products. That's why this endpoint makes a second call to
// the BigCommerce API to fetch the order details (line items) and the
// customer's email.
//
// On a paid order containing a course, this does two things:
//   1. ensures a Supabase auth account exists for the buyer, and grants
//      access to every course in the order;
//   2. emails the buyer a branded welcome with a one-click sign-in link.
//
// Both are idempotent. BigCommerce fires statusUpdated more than once per
// order (and retries on failure), so the email only goes out for course
// access that is genuinely new — never twice for the same purchase.

export async function POST(req: NextRequest) {
  const refused = await requireSharedSecret({
    variable: "BIGCOMMERCE_WEBHOOK_SECRET",
    header: "x-evolve-webhook-secret",
    got: req.headers.get("x-evolve-webhook-secret"),
    endpoint: "the BigCommerce order webhook, which creates accounts and emails real customers",
  });
  if (refused) return refused;

  const body = await req.json();
  const orderId = body?.data?.id;

  if (!orderId) {
    return NextResponse.json({ error: "missing order id" }, { status: 400 });
  }

  // Which storefront was this? Everything downstream depends on getting the
  // right credentials, so an unknown store is refused rather than guessed at.
  const storeHash = storeHashFromProducer(body?.producer);
  if (!storeHash) {
    return NextResponse.json({ error: "missing or malformed producer" }, { status: 400 });
  }

  const accessToken = tokenForStore(storeHash);
  if (!accessToken) {
    // A real order we cannot act on. Silence here is how a paying customer
    // waits indefinitely, so this one goes to the team.
    await notifyOnboardFailed({
      orderId,
      reason: `no API token configured for BigCommerce store ${storeHash}`,
    });
    return NextResponse.json({ error: `unknown store ${storeHash}` }, { status: 400 });
  }

  // 1. Fetch the full order (for the customer's email and its status)
  const orderRes = await fetch(
    `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}`,
    { headers: { "X-Auth-Token": accessToken, Accept: "application/json" } }
  );
  if (!orderRes.ok) {
    // A real order we were told about and cannot read. Returning quietly here
    // is how a paying customer disappears: BigCommerce records a failed
    // delivery, retries for 48 hours, disables the webhook, and nobody learns
    // why until someone complains. 401 in particular means our API token for
    // this store has been revoked — every sale on it is failing, not just
    // this one.
    await notifyOnboardFailed({
      orderId,
      reason:
        orderRes.status === 401
          ? `API token for store ${storeHash} is rejected (401) — EVERY order on ` +
            "this storefront is failing to onboard until it is replaced"
          : `could not read order from store ${storeHash} (HTTP ${orderRes.status})`,
    });
    return NextResponse.json({ error: "could not read order" }, { status: 502 });
  }
  const order = await orderRes.json();

  // Only grant access once the customer has actually paid.
  if (!isPaidStatus(order.status_id)) {
    return NextResponse.json({
      ok: true,
      skipped: "order not paid yet",
      statusId: order.status_id,
    });
  }

  const customerEmail = order.billing_address?.email;
  if (!customerEmail) {
    return NextResponse.json({ error: "missing customer email" }, { status: 400 });
  }

  // 2. Fetch the order's products
  const productsRes = await fetch(
    `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}/products`,
    { headers: { "X-Auth-Token": accessToken, Accept: "application/json" } }
  );
  const products = await productsRes.json();
  // Matched by SKU where we recognise one: product ids are per-store, so the
  // same course carries a different id on each storefront. The store is
  // passed in because the raw id is only meaningful on the storefront the
  // courses table was written against.
  const lines = Array.isArray(products) ? products : [];
  const purchasedProductIds = courseProductIds(lines, storeHash);

  // Scoping the fallback to one store is right but silent, so anything it
  // steps over that might have been a course is reported once per window.
  const unmatched = unmappedCourseCandidates(lines, storeHash);
  for (const line of unmatched) {
    // Keyed per product, not per store. Keyed per store, an .es wig selling
    // every few minutes would hold the window open and a renamed course
    // inside it would never be announced — the same shape as one bad mailbox
    // muting a mail outage, which is a mistake this codebase has made before.
    await notifyOnce(`unmapped:${candidateKey(storeHash, line)}`, () =>
      notifyUnmappedCourseSku({ storeHash, orderId, lines: [line] })
    );
  }

  // A catalogue store we hold no token for turns every storefront into
  // SKU-only matching, which is a quiet way to stop onboarding .ca buyers
  // whose SKU we do not know.
  if (!catalogueStoreIsConfigured()) {
    await notifyOnce("catalogue-store-missing", () =>
      notifyConfigProblem({
        what: "COURSE_CATALOGUE_STORE",
        detail: `it names ${catalogueStoreHash()}, which is not one of the stores we hold a token for, so course product ids cannot be read on any storefront`,
      })
    );
  }

  const admin = supabaseAdmin();

  // 3. Match those product_id values to courses that exist in our table
  const { data: matchedCourses } = await admin
    .from("courses")
    .select("id, title, bigcommerce_product_id")
    .in("bigcommerce_product_id", purchasedProductIds);

  if (!matchedCourses || matchedCourses.length === 0) {
    return NextResponse.json({ ok: true, skipped: "none of the order's products is a course" });
  }

  // 4. Find or create the Supabase user by email
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
      return NextResponse.json({ error: "could not create user" }, { status: 500 });
    }
    user = created.user;
  }

  // An existing account from before we recorded names still gets one.
  await rememberStudentName(user.id, buyerName);

  // 5. Grant access — but first work out what the buyer does NOT already
  //    have, so a repeat webhook doesn't re-send the welcome email.
  const { data: existing } = await admin
    .from("purchases")
    .select("course_id")
    .eq("user_id", user.id);

  const alreadyOwned = new Set((existing ?? []).map((p) => p.course_id));
  const newCourses = matchedCourses.filter((c) => !alreadyOwned.has(c.id));

  if (newCourses.length === 0) {
    return NextResponse.json({ ok: true, skipped: "access already granted" });
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
    await notifyOnboardFailed({
      email: customerEmail,
      orderId,
      reason: `could not grant access: ${insertError.message}`,
    });
    return NextResponse.json({ error: "could not grant access" }, { status: 500 });
  }

  // 6. Welcome the buyer in. Access is already granted at this point, so a
  //    mail failure must not fail the webhook — BigCommerce would retry the
  //    whole thing and we'd rather not loop on a mail server hiccup.
  // This is the path real buyers arrive on, and the email it sends carries a
  // working sign-in link. It was still building that link from the request
  // header: lower risk than the password reset, since a caller needs the
  // webhook secret to get here at all, but the same mistake, and missed
  // because the earlier pass fixed the files it had already touched rather
  // than every path that builds a link for an inbox.
  //
  // The course is granted above, so this degrades rather than throws: access
  // stands and the chat message says they were not emailed.
  const where = await emailOriginOrReason(req.headers, "a store purchase welcome");
  const { sent: emailed, reason: emailError } = where.origin
    ? await sendCourseWelcome({
        to: customerEmail,
        courseTitles: newCourses.map((c) => c.title),
        origin: where.origin,
        locale: localeForCourses(newCourses.map((c) => c.bigcommerce_product_id)),
        userId: user.id,
      })
    : { sent: false as const, reason: where.reason };

  await notifyOnboarded({
    email: customerEmail,
    courseTitles: newCourses.map((c) => c.title),
    source: "store",
    newAccount: isNewAccount,
    emailed,
    emailError,
    orderId,
  });

  return NextResponse.json({
    ok: true,
    coursesGranted: newCourses.length,
    emailed,
    ...(emailError ? { emailError } : {}),
  });
}

// listUsers() is paginated and defaults to the first 50 accounts. Scanning
// only page one would silently miss returning customers once the school
// passes 50 students, and createUser would then fail on the duplicate.
async function findUserByEmail(
  admin: ReturnType<typeof supabaseAdmin>,
  email: string
): Promise<User | null> {
  const target = email.toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`could not list users: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < perPage) break; // last page
  }
  return null;
}
