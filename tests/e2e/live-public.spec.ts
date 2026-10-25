import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { assertProdOptIn } from "../support/prod-guard";

// Read-only GETs against production. Nothing in this file submits a login,
// a password reset, a webhook, a cron call, or any other write.
// Loaded only from playwright.prod.config.ts, which requires E2E_ALLOW_PROD=1.

test.beforeAll(() => {
  assertProdOptIn(process.env);
});

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test.describe("live public site", () => {
  test("home page renders, links resolve, and a phone width does not overflow", async ({ page, request }) => {
    const errors = watchConsole(page);
    const response = await page.goto("/");
    expect(response?.ok()).toBeTruthy();
    await expect(page).toHaveTitle(/Evolve Academy/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/login");

    const images = page.locator("img");
    for (let i = 0; i < (await images.count()); i++) {
      const src = await images.nth(i).getAttribute("src");
      const alt = await images.nth(i).getAttribute("alt");
      expect(alt, src || "image").not.toBeNull();
      if (!src || src.startsWith("data:")) continue;
      const asset = await request.get(new URL(src, page.url()).toString());
      expect(asset.status(), src).toBeLessThan(400);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    const interesting = errors.filter(
      (line) => !/favicon|Failed to load resource/i.test(line)
    );
    expect(interesting).toEqual([]);
  });

  test.fail("BUG-A11Y: homepage clips expose playback controls", async ({ page }) => {
    await page.goto("/");
    const videos = page.locator("video");
    expect(await videos.count()).toBeGreaterThan(0);
    for (let i = 0; i < (await videos.count()); i++) {
      const video = videos.nth(i);
      expect(await video.evaluate((node) => node.hasAttribute("controls"))).toBe(true);
    }
  });

  test("login and password reset render, and empty forms are rejected in the browser", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in to your courses" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
    const loginBlocked = await page.locator("form").evaluate((form: HTMLFormElement) => form.reportValidity());
    expect(loginBlocked).toBe(false);

    await page.getByRole("button", { name: "Email me a one-time link" }).click();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    await page.getByRole("button", { name: "Sign in with a password" }).click();

    await page.goto("/login?error=link");
    await expect(page.getByText(/didn't work/i)).toBeVisible();
    await page.goto("/login?reset=1");
    await expect(page.getByText("password has been changed")).toBeVisible();

    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    const resetBlocked = await page.locator("form").evaluate((form: HTMLFormElement) => form.reportValidity());
    expect(resetBlocked).toBe(false);
    await page.getByRole("link", { name: "Back to sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("protected pages and the legacy course URL do not reveal lesson content", async ({ page, request }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
    await page.goto("/account/password");
    await page.waitForURL("**/login");
    await page.goto("/admin");
    await page.waitForURL(/\/login\?next=%2Fadmin/);
    await page.goto("/admin/students");
    await page.waitForURL(/\/login\?next=%2Fadmin%2Fstudents/);

    const legacy = await request.get("/curso/anything", { maxRedirects: 0 });
    expect(legacy.status()).toBe(308);
    expect(legacy.headers().location).toContain("/course/anything");

    const injected = await request.get("/course/%27%20OR%201%3D1--", { maxRedirects: 0 });
    expect(injected.status()).toBeLessThan(500);

    const missing = await request.get("/no-such-page");
    expect(missing.status()).toBe(404);
  });

  test.fail("BUG-HEADERS: responses send baseline security headers", async ({ request }) => {
    const home = await request.get("/");
    expect(home.ok()).toBeTruthy();
    const headers = home.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBeTruthy();
    expect(headers["strict-transport-security"] || "").toMatch(/max-age=\d+/);
    const framed =
      /deny|sameorigin/i.test(headers["x-frame-options"] || "") ||
      /frame-ancestors/i.test(headers["content-security-policy"] || "");
    expect(framed).toBe(true);
    expect(headers["x-powered-by"] ?? "").toBe("");
  });

  test("the browser bundle does not contain the service role key", async ({ page }) => {
    await page.goto("/login");
    const leak = await page.evaluate(async () => {
      const texts: string[] = [document.documentElement.outerHTML];
      for (const script of document.querySelectorAll("script[src]")) {
        const src = (script as HTMLScriptElement).src;
        if (!src.includes(location.host)) continue;
        texts.push(await (await fetch(src)).text());
      }
      let serviceRole = false;
      let anon = "";
      let supabaseUrl = "";
      const tokenPattern = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
      for (const text of texts) {
        const host = text.match(/https:\/\/[a-z0-9]+\.supabase\.co/);
        if (host) supabaseUrl = host[0];
        for (const token of text.match(tokenPattern) || []) {
          try {
            const payload = JSON.parse(
              atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
            );
            if (payload.role === "service_role") serviceRole = true;
            if (payload.role === "anon") anon = token;
          } catch {
            // not a JWT we can read
          }
        }
      }
      if (!supabaseUrl || !anon) {
        return { serviceRole, configured: false, videosStatus: 0, videosPublic: false, purchasesVisible: false, adminsVisible: false, progressVisible: false };
      }
      const headers = { apikey: anon, Authorization: `Bearer ${anon}` };
      const videosRes = await fetch(`${supabaseUrl}/rest/v1/course_videos?select=source_id&limit=1`, { headers });
      const videos = await videosRes.json();
      const purchases = await (await fetch(`${supabaseUrl}/rest/v1/purchases?select=id&limit=1`, { headers })).json();
      const admins = await (await fetch(`${supabaseUrl}/rest/v1/admins?select=email&limit=1`, { headers })).json();
      const progress = await (await fetch(`${supabaseUrl}/rest/v1/lesson_progress?select=video_id&limit=1`, { headers })).json();
      return {
        serviceRole,
        configured: true,
        videosStatus: videosRes.status,
        videosPublic: Array.isArray(videos) && videos.some((row) => typeof row?.source_id === "string" && row.source_id.length > 0),
        purchasesVisible: Array.isArray(purchases) && purchases.length > 0,
        adminsVisible: Array.isArray(admins) && admins.length > 0,
        progressVisible: Array.isArray(progress) && progress.length > 0,
      };
    });

    expect(leak.serviceRole).toBe(false);
    expect(leak.configured).toBe(true);
    expect(leak.purchasesVisible).toBe(false);
    expect(leak.adminsVisible).toBe(false);
    expect(leak.progressVisible).toBe(false);
    expect(leak.videosStatus).toBe(200);
  });

  test.fail("BUG-RLS: an anonymous client cannot read lesson source ids", async ({ page }) => {
    await page.goto("/login");
    const videosPublic = await page.evaluate(async () => {
      const texts: string[] = [];
      for (const script of document.querySelectorAll("script[src]")) {
        const src = (script as HTMLScriptElement).src;
        if (src.includes(location.host)) texts.push(await (await fetch(src)).text());
      }
      let anon = "";
      let supabaseUrl = "";
      const tokenPattern = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
      for (const text of texts) {
        const host = text.match(/https:\/\/[a-z0-9]+\.supabase\.co/);
        if (host) supabaseUrl = host[0];
        for (const token of text.match(tokenPattern) || []) {
          try {
            const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            if (payload.role === "anon") anon = token;
          } catch {
            // ignore
          }
        }
      }
      if (!supabaseUrl || !anon) return false;
      const videos = await (
        await fetch(`${supabaseUrl}/rest/v1/course_videos?select=source_id&limit=1`, {
          headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        })
      ).json();
      return Array.isArray(videos) && videos.some((row) => typeof row?.source_id === "string" && row.source_id.length > 0);
    });
    expect(videosPublic).toBe(false);
  });

  test("axe reports no serious or critical violations on the home and login pages", async ({ page }) => {
    for (const path of ["/", "/login"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical"
      );
      expect(blocking.map((violation) => violation.id)).toEqual([]);
    }
  });

  test.fail("BUG-A11Y: home and login expose a main landmark and keep content in regions", async ({ page }) => {
    for (const path of ["/", "/login"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      const ids = results.violations.map((violation) => violation.id);
      expect(ids, path).not.toContain("landmark-one-main");
      expect(ids, path).not.toContain("region");
    }
  });
});
