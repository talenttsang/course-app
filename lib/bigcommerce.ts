// We sell the same courses from several BigCommerce storefronts — .com, .ca,
// .es, with more to come — and each one is a separate store with its own API
// token. The webhook has to work out which store an order belongs to before
// it can fetch anything, because a token for one store returns 404 for every
// order in another.

// BIGCOMMERCE_STORES is a JSON object of store hash -> access token, e.g.
//   {"gmosz3ja":"abc…","qet21urb3p":"def…"}
// set on the Cloud Run service. The single-store BIGCOMMERCE_STORE_HASH /
// BIGCOMMERCE_ACCESS_TOKEN pair is still honoured so nothing breaks while
// both are configured.
export function storeTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};

  const legacyHash = process.env.BIGCOMMERCE_STORE_HASH;
  const legacyToken = process.env.BIGCOMMERCE_ACCESS_TOKEN;
  if (legacyHash && legacyToken) tokens[legacyHash] = legacyToken;

  const raw = process.env.BIGCOMMERCE_STORES;
  if (raw) {
    try {
      for (const [hash, token] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
        if (typeof token === "string" && token) tokens[hash] = token;
      }
    } catch {
      console.error("[bigcommerce] BIGCOMMERCE_STORES is not valid JSON — ignoring it");
    }
  }

  return tokens;
}

// BigCommerce stamps every webhook with the store it came from, as
// "stores/<hash>". That is the only reliable way to tell them apart: order
// ids are per-store and collide across them.
export function storeHashFromProducer(producer: unknown): string | null {
  if (typeof producer !== "string") return null;
  const match = producer.match(/^stores\/([A-Za-z0-9]+)$/);
  return match ? match[1] : null;
}

export function tokenForStore(hash: string): string | null {
  return storeTokens()[hash] ?? null;
}

// Products are per-store: the Spanish certificate is 3827 on one storefront
// and 3848 on another, so an order's product_id alone cannot say which
// course was bought. SKUs are the same everywhere, so they are the stable
// key across stores and the one we match on.
//
// This maps a SKU to the product id held in courses.bigcommerce_product_id.
// It belongs in the database — a course_products table, or a sku column —
// and should move there when schema changes are possible.
//
// Those ids are .ca's, so the order's own product_id only means anything on
// .ca. Reading it anywhere else compares an id to a catalogue it does not
// belong to, and on .es two of the four collide with real, sellable
// products: 3827 is a 1105 wig and 3986 is a 44 curl ring. Either sale
// would have granted a course nobody bought and sent a welcome email for
// it. So the fallback is now scoped to the store the ids come from, and
// every other store has to produce a SKU we know.
// Keys are lower-cased, and lookups lower-case the incoming SKU, because the
// same course is spelled differently per storefront: the in-person course is
// "academyExtended_In_Person" on .ca and "academyExtended_in_person" on .com.
// Matching exactly would have quietly failed to onboard every in-person buyer
// on one of them, with no error anywhere.
const SKU_TO_COURSE_PRODUCT: Record<string, number> = {
  academystarter: 3463,
  academyextended: 3464,
  "academyextended spanish": 3827,
  academyextended_in_person: 3986,
};

// The storefront whose catalogue courses.bigcommerce_product_id refers to.
// A product id from any other store is a number that happens to be in range.
//
// Overridable, because a hash hardcoded in source is a fact about the
// business pinned in a file nobody looks at: move the courses to another
// storefront and this is silently wrong, in the direction of granting a
// course to whoever buys the colliding product. Default kept so nothing
// needs configuring today.
export function catalogueStoreHash(): string {
  return (process.env.COURSE_CATALOGUE_STORE || "gmosz3ja").trim().toLowerCase();
}

// BigCommerce hashes are lower-case, but the override is typed by a human
// and "GMOSZ3JA" meaning something different from "gmosz3ja" is a trap with
// no upside.
function isCatalogueStore(storeHash?: string) {
  return (storeHash ?? "").trim().toLowerCase() === catalogueStoreHash();
}

// True when the catalogue store is not one of the stores we hold a token
// for -- which means either the override is wrong or that storefront has
// dropped out of BIGCOMMERCE_STORES. Either way every order now resolves by
// SKU alone, so a course sale on the catalogue store with an unrecognised
// SKU would be ignored. Worth saying out loud rather than discovering later.
export function catalogueStoreIsConfigured(): boolean {
  const wanted = catalogueStoreHash();
  return Object.keys(storeTokens()).some((hash) => hash.trim().toLowerCase() === wanted);
}

// Products that share an id with one of our courses and are plainly not
// courses. Without this the .es wig books an alert on every sale, and
// standing noise is exactly how the one alert that matters gets missed.
//
// Keyed by SKU rather than id because a SKU is what a human recognises, and
// because an id that moves is the thing we are defending against.
const KNOWN_NOT_A_COURSE: Record<string, string[]> = {
  // 3827 is "Certificado en Prótesis Capilares" in our table and
  // "SelenaL - Peluca Médica Premium" on .es; 3986 is the in-person course
  // and a "Wave and Curl Ring".
  qet21urb3p: ["selenal", "curl ring"],
};

export type OrderLine = { product_id?: number; sku?: string };

// Which of our courses does this order line correspond to? Returns the
// product id used in the courses table, or null for a line that is not a
// course at all.
export function courseProductIdFor(line: OrderLine, storeHash?: string): number | null {
  const sku = line.sku?.trim().toLowerCase();
  if (sku && sku in SKU_TO_COURSE_PRODUCT) return SKU_TO_COURSE_PRODUCT[sku];

  // Without a store we cannot know whose catalogue this id belongs to, and
  // guessing wrong grants a course to someone who bought a wig. The SKU is
  // the only answer that holds everywhere.
  if (!isCatalogueStore(storeHash)) return null;

  return typeof line.product_id === "number" ? line.product_id : null;
}

// Lines we are about to ignore that might have been a course.
//
// Scoping the id fallback to one store is right, but it is silent: a course
// sold on .com or .es under a SKU we do not know now resolves to nothing,
// and a real buyer waits forever for access nobody knows they are missing.
// We cannot tell that case from the collision it protects against -- both
// are "an id that matches a course, with a SKU we do not recognise" -- so
// both are reported, and whoever reads it can tell at a glance which it is.
//
// Two signals. A product id matching one of ours is the collision shape. A
// SKU that starts like a course SKU but is not in the map is the renamed-
// course shape, which is how this would most plausibly break.
export function unmappedCourseCandidates(lines: OrderLine[], storeHash?: string) {
  if (isCatalogueStore(storeHash)) return [];

  const courseIds = new Set(Object.values(SKU_TO_COURSE_PRODUCT));
  const benign = new Set(KNOWN_NOT_A_COURSE[(storeHash ?? "").trim().toLowerCase()] ?? []);

  return (lines ?? []).filter((line) => {
    const sku = line.sku?.trim().toLowerCase() ?? "";
    if (sku && sku in SKU_TO_COURSE_PRODUCT) return false;
    if (sku && benign.has(sku)) return false;
    if (typeof line.product_id === "number" && courseIds.has(line.product_id)) return true;
    return sku.startsWith("academy");
  });
}

// What this line is, for throttling. Two different products must never
// share a window: that is how a wig sale every ten minutes keeps a renamed
// course permanently silent.
export function candidateKey(storeHash: string, line: OrderLine) {
  const sku = line.sku?.trim().toLowerCase();
  return `${storeHash}:${sku || `id-${line.product_id ?? "unknown"}`}`;
}

export function courseProductIds(lines: OrderLine[], storeHash?: string): number[] {
  const ids = lines
    .map((line) => courseProductIdFor(line, storeHash))
    .filter((id): id is number => id !== null);
  return Array.from(new Set(ids));
}

// Shared secret sent as a header on every webhook we register, and checked
// on the way in. Without it the endpoint is an unauthenticated URL that acts
// on any order id it is handed — not catastrophic, since it can only grant a
// real buyer access to what they actually paid for, but it lets anyone
// outside trigger our mail sending and enumerate which orders contain
// courses. Unset, the check is skipped so an existing deployment keeps
// working until the secret is configured.
// The route itself goes through requireSharedSecret, which also alerts and
// answers 503 when the secret is missing. This stays for anything else that
// needs the plain answer, and agrees with it: an unset secret authorises
// nobody in production.
export function webhookSecretOk(headerValue: string | null): boolean {
  const expected = process.env.BIGCOMMERCE_WEBHOOK_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  if (!headerValue) return false;

  // Constant-time-ish compare: bail on length first, then diff every byte so
  // the time taken doesn't reveal how much of the prefix was right.
  if (headerValue.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= headerValue.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// BigCommerce order statuses that mean the customer has paid.
//
// This list used to be [10, 11] — Completed and Awaiting Fulfillment — which
// silently dropped a real buyer whose order went to Shipped. A course is
// digital: the moment payment clears the student should have it, whatever the
// fulfilment state of the order says.
//
// Deliberately an allow-list, not a deny-list. A status we have not thought
// about must not grant access on its own; the alternative fails open and
// hands out courses on refunded or disputed orders.
const PAID_STATUS_IDS = new Set([
  2, // Shipped
  3, // Partially Shipped
  8, // Awaiting Pickup
  9, // Awaiting Shipment
  10, // Completed
  11, // Awaiting Fulfillment
  14, // Partially Refunded
]);

// Not paid, or no longer paid: 0 Incomplete, 1 Pending, 4 Refunded,
// 5 Cancelled, 6 Declined, 7 Awaiting Payment, 12 Manual Verification
// Required, 13 Disputed.
//
// 14 Partially Refunded counts as paid, on the business's instruction: we
// give existing clients store credit towards a new course, which lands on the
// order as a partial refund while the course itself is very much sold. Those
// students must not be locked out of what they bought.
//
// The accepted trade-off: the status alone cannot say WHICH line was
// refunded, so an order where the course line itself was reversed now grants
// access. That is rarer than the store-credit case, and being wrong in that
// direction costs a refund we did not claw back rather than a paying student
// left waiting. Distinguishing the two needs the per-line refunds API, worth
// adding if partial refunds on course lines ever become common.
export function isPaidStatus(statusId: unknown): boolean {
  return typeof statusId === "number" && PAID_STATUS_IDS.has(statusId);
}
