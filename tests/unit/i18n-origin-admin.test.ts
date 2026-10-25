import { afterEach, describe, expect, it } from "vitest";
import { localeForCourses, localeForProduct } from "@/lib/i18n";
import { originFrom, publicOrigin } from "@/lib/origin";
import { isOwnerEmail, ownerEmails } from "@/lib/admin";
import { fullNameFromBilling } from "@/lib/students";
import { safeNextPath } from "@/lib/safe-next";
import { renderPasswordResetEmail, renderWelcomeEmail } from "@/lib/email";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("course language", () => {
  it("follows the course, and uses English when the set is mixed or empty", () => {
    expect(localeForProduct(3827)).toBe("es");
    expect(localeForProduct(3463)).toBe("en");
    expect(localeForProduct(null)).toBe("en");
    expect(localeForCourses([3827])).toBe("es");
    expect(localeForCourses([3827, 3827])).toBe("es");
    expect(localeForCourses([3827, 3463])).toBe("en");
    expect(localeForCourses([])).toBe("en");
  });
});

describe("public origin", () => {
  it("prefers PUBLIC_ORIGIN and strips a trailing slash", () => {
    process.env.PUBLIC_ORIGIN = "https://evolve.superhairpieces.com/";
    const request = new Request("http://0.0.0.0:8080/api", {
      headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" },
    });
    expect(publicOrigin(request)).toBe("https://evolve.superhairpieces.com");
  });

  it("falls back to the forwarded host when PUBLIC_ORIGIN is unset", () => {
    delete process.env.PUBLIC_ORIGIN;
    const request = new Request("http://0.0.0.0:8080/api", {
      headers: { "x-forwarded-host": "evolve.superhairpieces.com", "x-forwarded-proto": "https" },
    });
    expect(publicOrigin(request)).toBe("https://evolve.superhairpieces.com");
    expect(
      originFrom({
        get: (name) => (name === "host" ? "localhost:3000" : name === "x-forwarded-proto" ? "http" : null),
      })
    ).toBe("http://localhost:3000");
  });
});

describe("staff owners", () => {
  it("fails closed when ADMIN_EMAILS is empty and matches case-insensitively", () => {
    delete process.env.ADMIN_EMAILS;
    expect(ownerEmails()).toEqual([]);
    expect(isOwnerEmail("someone@example.com")).toBe(false);

    process.env.ADMIN_EMAILS = " Owner@Example.com , second@example.com ";
    expect(ownerEmails()).toEqual(["owner@example.com", "second@example.com"]);
    expect(isOwnerEmail("OWNER@example.com")).toBe(true);
    expect(isOwnerEmail(null)).toBe(false);
  });
});

describe("student names", () => {
  it("joins the billing name and ignores blanks", () => {
    expect(fullNameFromBilling({ first_name: "Jen", last_name: "Meyer" })).toBe("Jen Meyer");
    expect(fullNameFromBilling({ first_name: "Jen", last_name: "  " })).toBe("Jen");
    expect(fullNameFromBilling({ first_name: "", last_name: "" })).toBeNull();
    expect(fullNameFromBilling(null)).toBeNull();
    expect(fullNameFromBilling("Jen")).toBeNull();
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths and rejects off-site targets", () => {
    expect(safeNextPath("/admin")).toBe("/admin");
    expect(safeNextPath("/admin/students?q=1")).toBe("/admin/students?q=1");
    expect(safeNextPath("/course/starter")).toBe("/course/starter");
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });
});

describe("email rendering", () => {
  const base = {
    courseTitles: ["Starter Program"],
    signInUrl: "https://evolve.example/auth/confirm?token_hash=abc",
    loginUrl: "https://evolve.example/login",
    logoUrl: "https://evolve.example/shp-logo-email.png",
    linkHours: 24,
  };

  it("escapes a course title and keeps the dark header colour in both CSS and bgcolor", () => {
    const html = renderWelcomeEmail({ ...base, courseTitles: ["<script>alert(1)</script>"] });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('bgcolor="#141414"');
    expect(html).toContain("background-color:#141414");
    expect(html).toContain('bgcolor="#b50027"');
  });

  it("uses the Spanish copy for a Spanish course and the staff wording for a colleague", () => {
    const spanish = renderWelcomeEmail({ ...base, locale: "es" });
    expect(spanish).toContain("te damos la bienvenida");
    const staff = renderWelcomeEmail({ ...base, courseTitles: [], kind: "staff" });
    expect(staff).toContain("manage Evolve Academy");
    expect(staff).not.toContain("NOW IN YOUR ACCOUNT");
  });

  it("renders a password reset with the same shell", () => {
    const html = renderPasswordResetEmail({
      resetUrl: "https://evolve.example/auth/confirm?token_hash=abc",
      logoUrl: base.logoUrl,
      linkHours: 24,
      locale: "en",
    });
    expect(html).toContain("Choose a new password");
    expect(html).toContain('bgcolor="#ffffff"');
  });
});
