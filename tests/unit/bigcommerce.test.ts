import { afterEach, describe, expect, it } from "vitest";
import {
  catalogueStoreHash,
  courseProductIdFor,
  courseProductIds,
  unmappedCourseCandidates,
  isPaidStatus,
  storeTokens,
  tokenForStore,
} from "@/lib/bigcommerce";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("store credentials", () => {
  it("reads the legacy single-store pair and the JSON map", () => {
    process.env.BIGCOMMERCE_STORE_HASH = "legacy";
    process.env.BIGCOMMERCE_ACCESS_TOKEN = "legacy-token";
    process.env.BIGCOMMERCE_STORES = JSON.stringify({
      abc123: "token-a",
      legacy: "newer-token",
    });

    expect(storeTokens()).toEqual({
      legacy: "newer-token",
      abc123: "token-a",
    });
    expect(tokenForStore("abc123")).toBe("token-a");
    expect(tokenForStore("missing")).toBeNull();
  });

  it("ignores a BIGCOMMERCE_STORES value that is not JSON", () => {
    process.env.BIGCOMMERCE_STORE_HASH = "legacy";
    process.env.BIGCOMMERCE_ACCESS_TOKEN = "legacy-token";
    process.env.BIGCOMMERCE_STORES = "not-json";
    expect(storeTokens()).toEqual({ legacy: "legacy-token" });
  });
});

describe("course product matching", () => {
  it("matches a SKU case-insensitively to the catalog product id", () => {
    expect(courseProductIdFor({ sku: "AcademyExtended", product_id: 999 })).toBe(3464);
    expect(courseProductIdFor({ sku: "academyExtended_In_Person" })).toBe(3986);
    expect(courseProductIdFor({ sku: "academyextended spanish" })).toBe(3827);
  });

  // These two used to pass no store, because the fallback applied
  // everywhere. It no longer does: an id only means something on the
  // storefront the courses table was written against, and reading it
  // elsewhere granted a course to someone who bought a wig. The store is
  // now part of the question, so it is part of the test.
  it("falls back to the line's own product id when the SKU is unknown", () => {
    const ca = "gmosz3ja";
    expect(courseProductIdFor({ sku: "shampoo", product_id: 50 }, ca)).toBe(50);
    expect(courseProductIdFor({ product_id: 3463 }, ca)).toBe(3463);
    expect(courseProductIdFor({}, ca)).toBeNull();
    expect(courseProductIdFor({ sku: "  " }, ca)).toBeNull();
  });

  it("dedupes product ids from a mixed order", () => {
    expect(
      courseProductIds(
        [
          { sku: "academystarter", product_id: 1 },
          { sku: "academystarter", product_id: 1 },
          { sku: "not-a-course", product_id: 80 },
        ],
        "gmosz3ja"
      )
    ).toEqual([3463, 80]);
  });
});

describe("paid order statuses", () => {
  it("treats the documented paid statuses as paid, including a partial refund", () => {
    for (const id of [2, 3, 8, 9, 10, 11, 14]) expect(isPaidStatus(id)).toBe(true);
  });

  it("does not treat unpaid, refunded, cancelled, or string ids as paid", () => {
    for (const id of [0, 1, 4, 5, 6, 7, 12, 13, 15]) expect(isPaidStatus(id)).toBe(false);
    expect(isPaidStatus("10")).toBe(false);
    expect(isPaidStatus(null)).toBe(false);
    expect(isPaidStatus(undefined)).toBe(false);
  });
});

describe("course product ids are per-store", () => {
  // The ids in the courses table are .ca's. On .es, two of the four collide
  // with real, sellable products: 3827 is a €1105 wig and 3986 is a €44
  // curl ring. Reading the raw product_id there granted a course nobody
  // bought, and sent a welcome email saying so.
  it("does not read a raw product id from another store's catalogue", () => {
    const wig = { product_id: 3827, sku: "SelenaL" };
    const ring = { product_id: 3986, sku: "CURL RING" };

    expect(courseProductIdFor(wig, "qet21urb3p")).toBeNull();
    expect(courseProductIdFor(ring, "qet21urb3p")).toBeNull();
    expect(courseProductIds([wig, ring], "qet21urb3p")).toEqual([]);
  });

  it("still reads it on the store the ids come from", () => {
    expect(courseProductIdFor({ product_id: 3463, sku: "academyStarter" }, "gmosz3ja")).toBe(3463);
    // No SKU at all, on .ca: the fallback is what a single-store setup did.
    expect(courseProductIdFor({ product_id: 3464 }, "gmosz3ja")).toBe(3464);
  });

  it("matches a known SKU on every store, which is the point of the map", () => {
    // .es sells the Spanish certificate as product 3848, .com as 7447.
    expect(courseProductIdFor({ product_id: 3848, sku: "academyExtended Spanish" }, "qet21urb3p")).toBe(3827);
    expect(courseProductIdFor({ product_id: 7447, sku: "academyExtended Spanish" }, "cavofu")).toBe(3827);
    // Case differs per storefront and must not matter.
    expect(courseProductIdFor({ product_id: 7623, sku: "academyExtended_in_person" }, "cavofu")).toBe(3986);
    expect(courseProductIdFor({ product_id: 3986, sku: "academyExtended_In_Person" }, "gmosz3ja")).toBe(3986);
  });

  it("refuses the fallback when no store is given, rather than guessing", () => {
    expect(courseProductIdFor({ product_id: 3827, sku: "SelenaL" })).toBeNull();
  });
});

describe("a course sale we cannot match is reported, not swallowed", () => {
  // Scoping the id fallback to one store is right, but silent. A course sold
  // on .com or .es under a SKU we do not know now resolves to nothing, and a
  // real buyer waits for access nobody knows is missing.
  // Originally written with the .es wig, which is now allowlisted as a
  // collision we know about — that is the behaviour Vera asked for, so the
  // case moves to a product we have not seen before rather than being
  // dropped. The allowlist has its own tests below.
  it("flags a line whose id matches a course but whose SKU does not", () => {
    const surprise = { product_id: 3463, sku: "newly-listed-kit", name: "Starter Kit" };
    expect(unmappedCourseCandidates([surprise], "qet21urb3p")).toEqual([surprise]);
  });

  it("flags a renamed course SKU, which is how this would most plausibly break", () => {
    const renamed = { product_id: 7020, sku: "academyExtended_v2", name: "Extended course" };
    expect(unmappedCourseCandidates([renamed], "cavofu")).toEqual([renamed]);
  });

  it("stays quiet on SKUs it knows, and on ordinary products", () => {
    expect(
      unmappedCourseCandidates(
        [
          { product_id: 7447, sku: "academyExtended Spanish" },
          { product_id: 991, sku: "wig-tape-roll" },
        ],
        "cavofu"
      )
    ).toEqual([]);
  });

  it("stays quiet on the catalogue store, where the id is readable", () => {
    expect(unmappedCourseCandidates([{ product_id: 3827, sku: "anything" }], "gmosz3ja")).toEqual([]);
  });
});

describe("the catalogue store is configuration, not a constant in source", () => {
  const original = process.env.COURSE_CATALOGUE_STORE;
  afterEach(() => {
    if (original === undefined) delete process.env.COURSE_CATALOGUE_STORE;
    else process.env.COURSE_CATALOGUE_STORE = original;
  });

  it("defaults to .ca, so nothing needs configuring today", () => {
    delete process.env.COURSE_CATALOGUE_STORE;
    expect(catalogueStoreHash()).toBe("gmosz3ja");
  });

  it("follows the override, so moving the courses does not need a deploy", () => {
    process.env.COURSE_CATALOGUE_STORE = "cavofu";
    expect(catalogueStoreHash()).toBe("cavofu");
    // And the fallback follows it rather than staying pinned to .ca.
    expect(courseProductIdFor({ product_id: 3827, sku: "SelenaL" }, "gmosz3ja")).toBeNull();
    expect(courseProductIdFor({ product_id: 7019, sku: "unknown" }, "cavofu")).toBe(7019);
  });
});

describe("unmatched course lines", () => {
  // Standing noise is how a real alert gets missed, so the two .es products
  // known to share an id with a course are not reported at all.
  it("stays quiet on a collision we already know about", () => {
    expect(unmappedCourseCandidates([{ product_id: 3827, sku: "SelenaL" }], "qet21urb3p")).toEqual([]);
    expect(unmappedCourseCandidates([{ product_id: 3986, sku: "CURL RING" }], "qet21urb3p")).toEqual([]);
  });

  it("still reports an unknown collision on the same store", () => {
    const surprise = { product_id: 3464, sku: "something-new" };
    expect(unmappedCourseCandidates([surprise], "qet21urb3p")).toEqual([surprise]);
  });

  it("does not allowlist those SKUs on a store where they mean nothing", () => {
    const line = { product_id: 3827, sku: "SelenaL" };
    expect(unmappedCourseCandidates([line], "cavofu")).toEqual([line]);
  });
});

describe("the catalogue store hash is compared case-insensitively", () => {
  const original = process.env.COURSE_CATALOGUE_STORE;
  afterEach(() => {
    if (original === undefined) delete process.env.COURSE_CATALOGUE_STORE;
    else process.env.COURSE_CATALOGUE_STORE = original;
  });

  it("treats a hash typed in capitals as the same store", () => {
    process.env.COURSE_CATALOGUE_STORE = "GMOSZ3JA";
    expect(catalogueStoreHash()).toBe("gmosz3ja");
    expect(courseProductIdFor({ product_id: 3464 }, "gmosz3ja")).toBe(3464);
    expect(unmappedCourseCandidates([{ product_id: 3827, sku: "x" }], "GMOSZ3JA")).toEqual([]);
  });
});
