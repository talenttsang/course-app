import { expect, test, type Page, type Route } from "@playwright/test";

// Read-only production admin pass. Credentials come from the environment and
// are never written to disk by this file. Mutating server actions and
// Supabase writes are aborted before they leave the browser.

const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;

async function blockWrites(page: Page) {
  const blocked: string[] = [];
  await page.route("**/*", async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const nextAction = req.headers()["next-action"];
    const supabaseWrite =
      /supabase\.co\/rest\/v1\//.test(url) && ["POST", "PATCH", "PUT", "DELETE"].includes(method);
    const authWrite =
      /supabase\.co\/auth\/v1\//.test(url) &&
      method !== "GET" &&
      !url.includes("/auth/v1/token") &&
      !url.includes("/auth/v1/logout");
    if (nextAction || supabaseWrite || authWrite) {
      blocked.push(`${method} ${url.split("?")[0]}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
  return blocked;
}

test.describe("live admin (read only)", () => {
  test.skip(
    process.env.E2E_ALLOW_LIVE_ADMIN !== "1",
    "Manual only. Set E2E_ALLOW_LIVE_ADMIN=1 to sign in to production. This test is not part of CI."
  );
  test.skip(!email || !password, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run the live admin pass.");

  test("staff can open every admin screen without writing", async ({ page }) => {
    test.setTimeout(180_000);
    const blocked = await blockWrites(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/login?next=/admin");
    await page.getByLabel("Email address").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/admin(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Courses" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Manage students" })).toBeVisible();

    const courseRows = page.locator("table.admin-table").first().locator("tbody tr");
    expect(await courseRows.count()).toBeGreaterThan(0);
    expect(await page.locator("table.admin-table").nth(1).locator("tbody tr").count()).toBeGreaterThan(0);

    const addBlocked = await page
      .locator("form")
      .filter({ has: page.locator("#title") })
      .evaluate((form: HTMLFormElement) => form.reportValidity());
    expect(addBlocked).toBe(false);

    const staffBlocked = await page
      .locator("form")
      .filter({ has: page.locator("#staff-email") })
      .evaluate((form: HTMLFormElement) => form.reportValidity());
    expect(staffBlocked).toBe(false);

    await page.getByRole("link", { name: "Manage lessons" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add lessons" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete course" })).toBeVisible();

    await page.getByRole("link", { name: "All courses" }).click();
    await page.getByRole("link", { name: "Manage students" }).click();
    await expect(page.getByRole("heading", { name: "Students", exact: true })).toBeVisible();
    await expect(page.locator(".admin-section-head span").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /next page/i })).toHaveCount(0);

    await page.getByPlaceholder("Search by name or email").fill("zzz-no-match-qa-search");
    await expect(page.getByText("No student matches that search.")).toBeVisible();
    await page.getByPlaceholder("Search by name or email").fill("");

    const grantBlocked = await page
      .locator("form")
      .filter({ has: page.locator("#student-email") })
      .evaluate((form: HTMLFormElement) => form.reportValidity());
    expect(grantBlocked).toBe(false);

    await page.getByRole("link", { name: "Manage" }).first().click();
    await expect(page.getByRole("heading", { name: "Course access" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend sign-in link" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete this account" })).toBeVisible();
    await page.getByRole("button", { name: "Change email" }).click();
    await expect(page.getByRole("button", { name: "Save email" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Save email" })).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "My courses" })).toBeVisible();
    const courseLinks = page.locator('a[href^="/course/"]');
    if ((await courseLinks.count()) > 0) {
      await courseLinks.first().click();
      await page.waitForURL(/\/course\//);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator("main").first()).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 720 });
    }

    await page.goto("/account/password");
    await expect(page.getByRole("heading", { name: /password/i })).toBeVisible();
    const newPassword = page.locator("#password");
    const confirmPassword = page.locator("#confirm");
    await newPassword.fill("short");
    await confirmPassword.fill("short");
    const currentPassword = page.locator("#current");
    if ((await currentPassword.count()) > 0) await currentPassword.fill("not-the-password");
    await page.getByRole("button", { name: /Change password|Save password/ }).click();
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();

    await page.getByRole("button", { name: "SIGN OUT" }).click();
    await page.waitForURL("**/login");
    await page.goto("/admin");
    await page.waitForURL(/\/login\?next=%2Fadmin/);

    expect(blocked, "a write was attempted during the read-only admin pass").toEqual([]);
    const interesting = errors.filter((line) => !/favicon/i.test(line));
    expect(interesting).toEqual([]);
  });

  test.fail("BUG-LAYOUT: admin pages fit a phone width", async ({ page }) => {
    test.setTimeout(180_000);
    await blockWrites(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login?next=/admin");
    await page.getByLabel("Email address").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/admin(?:\?|$)/);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test.fail("BUG-FORM: an empty add-lessons form is rejected in the browser", async ({ page }) => {
    test.setTimeout(180_000);
    await blockWrites(page);
    await page.goto("/login?next=/admin");
    await page.getByLabel("Email address").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/admin(?:\?|$)/);
    await page.getByRole("link", { name: "Manage lessons" }).first().click();
    const lessonBlocked = await page
      .locator("form")
      .filter({ has: page.locator("#bulk") })
      .evaluate((form: HTMLFormElement) => {
        const bulk = form.querySelector("#bulk") as HTMLTextAreaElement | null;
        if (bulk) bulk.value = "";
        return form.reportValidity();
      });
    expect(lessonBlocked).toBe(false);
  });
});
