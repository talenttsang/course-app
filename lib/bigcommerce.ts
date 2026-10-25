// We sell the same courses from several BigCommerce storefronts — .com, .ca,
// .es, with more to come — and each one is a separate store with its own API
// token. Every order is read with the token for the store it belongs to,
// because a token for one store returns 404 for every order in another.

// BIGCOMMERCE_STORES is a JSON object of store hash -> access token, e.g.
//   {"gmosz3ja":"abc…","qet21urb3p":"def…"}
// set on the service. The single-store BIGCOMMERCE_STORE_HASH /
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

// The storefront whose catalogue courses.bigcommerce_product_id refers to:
// .ca. A product id from any other store is a number that happens to be in
// range. Move the courses to another storefront and this must change with
// them, or the fallback grants a course to whoever buys the colliding product.
export const CATALOGUE_STORE = "gmosz3ja";

// BigCommerce hashes are lower-case, but one typed into BIGCOMMERCE_STORES by
// a human may not be, and "GMOSZ3JA" meaning something different from
// "gmosz3ja" is a trap with no upside.
function isCatalogueStore(storeHash?: string) {
  return (storeHash ?? "").trim().toLowerCase() === CATALOGUE_STORE;
}

// True when the catalogue store is not one of the stores we hold a token
// for -- which means that storefront has dropped out of BIGCOMMERCE_STORES. Either way every order now resolves by
// SKU alone, so a course sale on the catalogue store with an unrecognised
// SKU would be ignored. Worth saying out loud rather than discovering later.
export function catalogueStoreIsConfigured(): boolean {
  return Object.keys(storeTokens()).some((hash) => isCatalogueStore(hash));
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

export function courseProductIds(lines: OrderLine[], storeHash?: string): number[] {
  const ids = lines
    .map((line) => courseProductIdFor(line, storeHash))
    .filter((id): id is number => id !== null);
  return Array.from(new Set(ids));
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
