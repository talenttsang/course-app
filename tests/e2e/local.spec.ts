import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { assertWritePathBaseUrl } from "../support/prod-guard";

const STUDENT = { email: "student@example.test", password: "Student-pass-123" };
const OUTSIDER = { email: "outsider@example.test", password: "Outsider-pass-123" };
const STAFF = { email: "staff@example.test", password: "Staff-pass-123" };

function mockOrigin() {
  const origin = (
    process.env.E2E_SUPABASE_URL || `http://127.0.0.1:${process.env.MOCK_SUPABASE_PORT || "54321"}`
  ).replace(/\/$/, "");
  assertWritePathBaseUrl(origin);
  return origin;
}

test.beforeEach(async ({ request, baseURL }) => {
  assertWritePathBaseUrl(baseURL);
  if (process.env.E2E_BASE_URL?.trim()) {
    const reset = process.env.E2E_RESET_URL?.trim();
    if (!reset) return;
    assertWritePathBaseUrl(reset);
    expect((await request.post(reset)).ok()).toBeTruthy();
    return;
  }
  expect((await request.post(`${mockOrigin()}/__test/reset`)).ok()).toBeTruthy();
});

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// The tick is painted before lesson_progress responds. Wait for that write
// so a reload cannot cancel it. A fixed delay would still race on a slow proxy.
function waitForLessonProgress(page: Page, method: "POST" | "DELETE") {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      response.url().includes("/rest/v1/lesson_progress") &&
      response.ok(),
    { timeout: 30_000 }
  );
}

test.describe("local public pages", () => {
  test("home, login, and password reset render and the legacy course path redirects", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("hair replacement specialist");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();

    const legacy = await request.get("/curso/starter", { maxRedirects: 0 });
    expect(legacy.status()).toBe(308);
    expect(legacy.headers().location).toContain("/course/starter");

    const missing = await request.get("/no-such-page");
    expect(missing.status()).toBe(404);

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in to your courses" })).toBeVisible();
    await page.getByRole("button", { name: "Email me a one-time link" }).click();
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign in with a password" }).click();
    await expect(page.getByLabel("Password")).toBeVisible();

    const blocked = await page.locator("form").evaluate((form: HTMLFormElement) => form.reportValidity());
    expect(blocked).toBe(false);
  });

  test.fail("BUG-A11Y: homepage clips expose playback controls", async ({ page }) => {
    await page.goto("/");
    const videos = page.locator("video");
    expect(await videos.count()).toBeGreaterThan(0);
    for (let i = 0; i < (await videos.count()); i++) {
      expect(await videos.nth(i).evaluate((node) => node.hasAttribute("controls"))).toBe(true);
    }
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
});

test.describe("local authentication and access", () => {
  test("a wrong password explains the one-time link, and off-site next targets are dropped", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").fill(STUDENT.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator(".auth-error")).toContainText(/one-time link/i);

    await page.goto("/login?next=//evil.example");
    await page.getByLabel("Email address").fill(STUDENT.email);
    await page.getByLabel("Password").fill(STUDENT.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");
    expect(page.url()).not.toContain("evil.example");
  });

  test("a student sees only purchased courses and not another course's video id", async ({ page }) => {
    await login(page, STUDENT.email, STUDENT.password);
    await expect(page.getByRole("heading", { name: "My courses" })).toBeVisible();
    await expect(page.getByText("Starter Program")).toBeVisible();
    await expect(page.getByText("Extended Program")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Manage courses" })).toHaveCount(0);

    await page.goto("/course/extended");
    await expect(page.getByText("isn't on your account")).toBeVisible();
    expect(await page.content()).not.toContain("cccdefghijk");

    await page.goto("/course/starter");
    await expect(page.locator('iframe[src*="abcdefghijk"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /Consultation/ })).toContainText("1/2");
  });

  test.fail("BUG-PROGRESS: the headline counts only lessons in this course", async ({ page }) => {
    await login(page, STUDENT.email, STUDENT.password);
    await page.goto("/course/starter");
    await expect(page.getByText("1 of 2 lessons")).toBeVisible();
  });

  test.fail("BUG-LAYOUT: the lesson player fits a phone width", async ({ page }) => {
    await login(page, STUDENT.email, STUDENT.password);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/course/starter");
    const main = await page.locator("main").boundingBox();
    expect(main?.width ?? 0).toBeGreaterThan(240);
  });

  test("completing a lesson is saved and can be cleared", async ({ page }) => {
    await login(page, STUDENT.email, STUDENT.password);
    await page.goto("/course/starter");
    await page.getByRole("button", { name: "Next lesson" }).click();
    await expect(page.getByRole("heading", { name: "Take the template" })).toBeVisible();
    const saved = waitForLessonProgress(page, "POST");
    await page.getByRole("button", { name: "Complete and continue" }).click();
    await saved;
    await expect(page.getByText("✓")).toHaveCount(2);

    await page.reload();
    await expect(page.getByText("✓")).toHaveCount(2);
    const cleared = waitForLessonProgress(page, "DELETE");
    await page.getByRole("button", { name: "Mark as not done" }).click();
    await cleared;
    await page.reload();
    await expect(page.getByText("✓")).toHaveCount(1);
  });

  test("an account with no courses can set nothing and sees the empty dashboard", async ({ page }) => {
    await login(page, OUTSIDER.email, OUTSIDER.password);
    await expect(page.getByText("No courses on this account yet")).toBeVisible();
    await page.goto("/course/does-not-exist");
    await expect(page.getByText("This page could not be found")).toBeVisible();
  });

  test("password rules are checked before the current password, then a change works", async ({ page }) => {
    await login(page, STUDENT.email, STUDENT.password);
    await page.goto("/account/password");
    await expect(page.getByRole("heading", { name: "Change your password" })).toBeVisible();
    await page.getByLabel("Current password").fill(STUDENT.password);
    await page.getByLabel("New password").fill("short");
    await page.getByLabel("Confirm password").fill("short");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();

    await page.getByLabel("New password").fill("New-pass-123");
    await page.getByLabel("Confirm password").fill("New-pass-999");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("don't match")).toBeVisible();

    await page.getByLabel("Confirm password").fill("New-pass-123");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("heading", { name: "Password saved" })).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("Email address").fill(STUDENT.email);
    await page.getByLabel("Password").fill("New-pass-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");
  });

  test("password reset does not reveal whether the address exists", async ({ page }) => {
    // What matters is that the two answers are the same, not what they say.
    // The form used to answer "Check your inbox" to everything, including
    // failures, so asserting that heading tested the bug as much as the
    // property. It now reports a failure of ours honestly -- and the local
    // stack runs without a mailer -- so pinning the wording would fail here
    // for the right behaviour. Compare the replies to each other instead.
    const answerFor = async (address: string) => {
      await page.goto("/forgot-password");
      await page.getByLabel("Email address").fill(address);
      await page.getByRole("button", { name: "Send reset link" }).click();
      // Wait for the answer itself, not for the button to change. The button
      // reads "Sending…" the moment it is clicked, so anything keyed to its
      // label is satisfied before the server action has returned -- which
      // passed here and failed on a slower CI runner, reading one reply
      // complete and the other still pending.
      await expect(
        page.locator(".auth-card").getByText(/Check your inbox|could not send/)
      ).toBeVisible({ timeout: 15000 });
      return (await page.locator(".auth-card").innerText()).replace(/\s+/g, " ").trim();
    };

    const unknown = await answerFor("nobody@example.test");
    const registered = await answerFor(STUDENT.email);

    // The address itself is echoed back on the success screen, so compare
    // with it removed.
    const withoutAddress = (text: string) =>
      text.replace("nobody@example.test", "ADDRESS").replace(STUDENT.email, "ADDRESS");

    expect(withoutAddress(registered)).toBe(withoutAddress(unknown));
  });
});

test.describe("local admin", () => {
  test("anonymous visitors are sent to sign in, and a student is refused", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForURL("**/login?next=%2Fadmin");
    await expect(page.getByText("Course admin")).toBeVisible();

    await login(page, STUDENT.email, STUDENT.password);
    await page.goto("/admin/students");
    await expect(page.getByText("does not have staff access")).toBeVisible();
    await page.goto(`/admin/students/${OUTSIDER.email}`);
    await expect(page.getByText("does not have staff access")).toBeVisible();
  });

  test("staff can add a course and a lesson, and a bad line adds nothing", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await login(page, STAFF.email, STAFF.password);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Courses" })).toBeVisible();
    await expect(page.getByText("Starter Program")).toBeVisible();
    await expect(page.getByText("Can't be removed here").first()).toBeVisible();

    await page.getByLabel("Course title").fill("Local QA Course");
    await page.getByLabel("BigCommerce product ID").fill("nope");
    await page.getByRole("button", { name: "Add course" }).click();
    await expect(page.getByText("whole number")).toBeVisible();

    await page.getByLabel("BigCommerce product ID").fill("999001");
    await page.getByRole("button", { name: "Add course" }).click();
    await expect(page.getByText("Local QA Course")).toBeVisible();
    await page.getByRole("link", { name: "Manage lessons" }).last().click();
    await expect(page.getByRole("heading", { name: "Local QA Course" })).toBeVisible();

    const lessonBox = page.getByRole("textbox", { name: "Lessons", exact: true });
    await lessonBox.fill("this line has no link");
    await page.getByRole("button", { name: "Add lessons" }).click();
    await expect(page.getByText("doesn't contain a YouTube or Google Drive link")).toBeVisible();

    await lessonBox.fill("Lighting | Part the hair | https://youtu.be/zzzdefghijk");
    await page.getByRole("button", { name: "Add lessons" }).click();
    await expect(page.getByText("Part the hair")).toBeVisible();

    await page.getByRole("button", { name: "Delete Part the hair" }).click();
    await expect(page.getByText("Part the hair")).toHaveCount(0);
    await page.getByRole("button", { name: "Delete course" }).click();
    await expect(page.getByRole("heading", { name: "Courses" })).toBeVisible();
    await expect(page.getByText("Local QA Course")).toHaveCount(0);
  });

  test.fail("BUG-LAYOUT: admin pages fit a phone width", async ({ page }) => {
    await login(page, STAFF.email, STAFF.password);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Courses" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test.fail("BUG-FORM: an empty add-lessons form is rejected in the browser", async ({ page }) => {
    await login(page, STAFF.email, STAFF.password);
    await page.goto("/admin");
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

  test("staff reach the Waiting page and see what stops onboarding", async ({ page }) => {
    await login(page, STAFF.email, STAFF.password);
    await page.goto("/admin");
    await page.getByRole("link", { name: "Waiting buyers →" }).click();
    await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();
    // The stand-in holds no store tokens and no SMTP, and the page must say so.
    await expect(page.getByText(/No BigCommerce store tokens are set/)).toBeVisible();
    await expect(page.getByText(/SMTP is not configured/)).toBeVisible();
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page.getByText(/Every course buyer in the last 10 days has their course/)).toBeVisible();
  });

  test("staff can grant and revoke a course, and cannot use a bad email", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await login(page, STAFF.email, STAFF.password);
    await page.goto("/admin/students");
    await page.getByPlaceholder("Search by name or email").fill("Olivia");
    await expect(page.getByText("1 of")).toBeVisible();
    await page.getByRole("link", { name: "Manage" }).click();
    await expect(page.getByRole("heading", { name: OUTSIDER.email })).toBeVisible();
    await expect(page.getByText("Granted by staff")).toHaveCount(0);

    const extended = page.getByRole("row", { name: /Extended Program/ });
    await extended.getByRole("button", { name: "Give access" }).click();
    await expect(extended.getByText("Granted by staff")).toBeVisible();
    await extended.getByRole("button", { name: "Remove access" }).click();
    await expect(extended.getByText("Granted by staff")).toHaveCount(0);

    await page.goto("/admin/students");
    await page.getByLabel("Email address").fill("not-an-email");
    const blocked = await page
      .locator("form")
      .filter({ has: page.locator("#student-email") })
      .evaluate((form: HTMLFormElement) => form.reportValidity());
    expect(blocked).toBe(false);
  });
});

test.describe("local APIs", () => {
  test("removed webhook and cron routes are gone, and onboard rejects unauthenticated callers", async ({ request }) => {
    expect((await request.post("/api/webhooks/bigcommerce", { data: { data: { id: 1 } } })).status()).toBe(404);
    expect((await request.get("/api/cron/reconcile")).status()).toBe(404);
    expect((await request.get("/api/cron/webhook-watchdog")).status()).toBe(404);
    const onboard = await request.post("/api/admin/onboard", {
      data: {},
      headers: { origin: "https://evil.example" },
    });
    expect(onboard.status()).toBe(401);
    const allow = onboard.headers()["access-control-allow-origin"];
    expect(allow === "*" || allow === "https://evil.example").toBe(false);
  });

  test("onboard allows a staff token and refuses a student token", async ({ request }) => {
    async function token(email: string, password: string) {
      const res = await request.post(`${mockOrigin()}/auth/v1/token?grant_type=password`, {
        data: { email, password },
      });
      expect(res.ok()).toBeTruthy();
      return (await res.json()).access_token as string;
    }

    const student = await token(STUDENT.email, STUDENT.password);
    const refused = await request.post("/api/admin/onboard", {
      headers: { authorization: `Bearer ${student}` },
      data: { email: "new@example.test", productId: 3463, notify: false },
    });
    expect(refused.status()).toBe(403);

    const staff = await token(STAFF.email, STAFF.password);
    const missing = await request.post("/api/admin/onboard", {
      headers: { authorization: `Bearer ${staff}` },
      data: { email: "new@example.test", productId: 424242, notify: false },
    });
    expect(missing.status()).toBe(404);

    const created = await request.post("/api/admin/onboard", {
      headers: { authorization: `Bearer ${staff}` },
      data: { email: "new@example.test", productId: 3463, notify: false, announce: false },
    });
    expect(created.status()).toBe(200);
    const body = await created.json();
    expect(body.ok).toBe(true);
    expect(body.created).toBe(true);
    expect(body.emailed).toBe(false);
  });
});
