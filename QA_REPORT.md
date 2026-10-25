# QA report — Evolve Academy

Read-only pass against https://evolve.superhairpieces.com, plus a local
suite that is allowed to create and delete data. No product bugs were fixed
in this change. The only application edit is a behavior-preserving move of
the sign-in redirect check into `lib/safe-next.ts`, so the unit tests call
the same function the login and auth routes use.

Known bugs are pinned with `it.fails` (Vitest) and `test.fail` (Playwright).
The suite stays green while the bug exists, and goes red when the bug is
fixed and the marker is still there.

## Test plan

There is no public sign-up, no checkout, and no orders or settings screen.
An account is created when a paid BigCommerce order is onboarded, or when
staff grant a course. "Orders" in this plan means that onboarding path.

| Area | What to cover |
|---|---|
| Public pages | `/`, `/login`, `/forgot-password`, unknown URL, `/curso/:slug` → `/course/:slug` |
| Auth | Password sign-in, one-time link mode, bad password, empty-field validation, open redirect on `next`, password rules, reset copy that does not reveal whether the address exists |
| Student | Dashboard shows only purchased courses, lesson player, progress save and clear, empty account, missing course |
| Admin UI | Course list, create course, bulk lessons, delete lesson, delete course, student search, grant and revoke, staff vs student vs anonymous |
| APIs | `POST /api/webhooks/bigcommerce`, `POST /api/admin/onboard`, `GET /api/cron/reconcile`, `GET /api/cron/webhook-watchdog` |
| Access control | Anonymous users reach login, a student cannot open `/admin` or call onboard, staff can, webhook and cron require their secrets |
| Security | Service-role key not in the browser bundle, RLS on purchases / progress / admins / lessons, CORS on onboard, security headers, injection-shaped slug |
| Layout and a11y | Phone width, homepage video controls, axe on `/` and `/login` |

Live admin is a separate, read-only pass. It may sign in, open every admin
screen, search, and reject invalid input in the browser. It must not create,
edit, delete, publish, import, email, refund, or charge anything, and it
must not change a password or a role.

## Where each check ran

| Check | Local (in-memory Supabase) | Live site |
|---|---|---|
| Public render, links, 404, legacy redirect | Yes | Yes |
| Login and reset validation, without sending mail | Yes | Yes, forms not submitted |
| Password change, course create, lesson add/delete, grant/revoke, onboard of a new user | Yes | No |
| Student isolation and progress save | Yes | Player opened read-only; progress not changed |
| Admin screens while signed in | Yes, fake staff | Yes, dedicated test admin, read-only |
| Webhook, cron, onboard authentication | Yes, with test secrets, and as known-failing tests when the secret is unset | Not called. Production smoke is read-only GETs |
| Phone player width | Yes | Yes, on a course the test account already had |
| axe, security headers, anon-key RLS probe | Headers and RLS on live only | Yes |

The local stand-in blanks SMTP, Google Chat, and BigCommerce store
credentials, including values loaded from `.env.local`, before `next dev`
starts. Password reset therefore logs that SMTP is not configured and does
not send mail. The webhook test for an unknown store cannot post to Chat
or call a real store.

## Results

- `npm test` — 8 files, 54 tests passed (includes the `it.fails` pins).
- `npm run test:e2e` — 20 passed. Seven of those are expected failures (homepage video controls, landmarks, security headers, progress headline, phone player, admin phone width, empty lesson form).
- Production smoke is opt-in and was not re-run from this change. The earlier public pass is unchanged except that cron, webhook, and onboarding calls are no longer part of it.
- Live admin is manual-only and was not re-run. No write left the browser on the earlier pass.

Homepage at 390×844 did not overflow (horizontal overflow ≤ 1px). Images on
the homepage returned under 400 and had `alt`. `lang` is `en`. Console
errors on the public pages, after ignoring a missing favicon, were empty.
`/course/' OR 1=1--` returned below 500. `/no-such-page` returned 404.
`/curso/anything` returned 308 to `/course/anything`.

Anonymous visits to `/dashboard`, `/account/password`, `/admin`, and
`/admin/students` landed on `/login`, with `next` set for the admin URLs.
Unauthenticated calls to onboard, the webhook, and both cron routes are
checked on the local stand-in, where each returns 401. Production smoke
does not call those routes. The earlier production pass did see 401 from
each of them while the secrets were set; that is not part of the smoke
set anymore, because an unset cron secret would let the smoke test itself
run a reconcile and post to Google Chat.

The browser bundle on `/login` contains the Supabase anon key and does not
contain a `service_role` key. With that anon key, `purchases`, `admins`, and
`lesson_progress` returned no rows. `course_videos.source_id` did return a
row. See BUG-RLS.

Axe on `/` and `/login` reported no critical or serious violations. Both
pages lack a `main` landmark (`landmark-one-main`, moderate). Content is
not consistently inside landmarks (`region`, moderate; 9 nodes on `/login`).

## Live admin

Signed in with the dedicated test admin account from `E2E_ADMIN_EMAIL` and
`E2E_ADMIN_PASSWORD`, then signed out. Screenshots, traces, and video were
off. A route hook aborted any Next.js server action and any Supabase REST
or auth write other than sign-in and sign-out. The hook's blocked list was
empty at the end, and the browser console had no errors.

Screens opened:

- Course list and staff table both rendered. Titles, lesson counts, student counts, names, and emails are not recorded here.
- First course's lesson editor. Add-lessons and Delete course are present. The empty lesson form is considered valid by the browser (`reportValidity()` is true) because the textarea is not `required`. The form was not submitted.
- Student list. There is no next-page control; search is client-side over the full list. Searching `zzz-no-match-qa-search` showed "No student matches that search." Clearing the box restored the list. The total is not recorded here.
- Empty "add a course", "add staff", and "give access" forms were rejected by the browser before a request.
- First student's detail. Course access, Resend sign-in link, and Delete this account are present. Change email opened Save email; Cancel closed it. Nothing was saved. The student's name and email are not recorded here.
- Dashboard for this account. The account already had courses, so the player could be opened without granting anything.
- First course player, read-only. The headline showed zero lessons completed. At 390×844 the lesson column (`main`) was 50px wide. The document itself did not grow a horizontal scrollbar (`scrollWidth` matched the viewport) because the player locks the page to `100vh` and hides overflow. Complete was not clicked.
- Password form. A 5-character new password was rejected in the page with "Use at least 8 characters." before any password update. The account password was not changed.
- `/admin` at 390×844. The document was 419px wider than the viewport.
- Sign out, then `/admin` again, which redirected to `/login?next=%2Fadmin`.

## Bugs

### High — lesson source ids are world-readable (BUG-RLS)

**Where:** live, and `supabase/schema.sql`.

**Steps:** Load `/login`, read the anon key from the page's own scripts, `GET {supabase}/rest/v1/course_videos?select=source_id&limit=1` with `apikey` and `Authorization: Bearer` set to that anon key.

**Expected:** No lesson source id without a purchase. The course page comments say the video id never reaches the browser unless the viewer owns the course.

**Actual:** HTTP 200 and a non-empty `source_id`. The same anon client cannot read `purchases`, `admins`, or `lesson_progress`.

**Why:** `course_videos` has RLS policy "anyone can see the listed lessons" `using (true)`. The anon key is public by design (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), so the policy is the gate. An unlisted YouTube or Drive id is the capability to open the lesson.

### High — the lesson player does not fit a phone (BUG-LAYOUT)

**Where:** live player, and locally. `app/course/[slug]/course-viewer.tsx`.

**Steps:** Open a course with lessons at 390×844.

**Expected:** The video column stays usable (the local pin requires `main` wider than 240px).

**Actual:** On the live course the `main` column was 50px wide. The chapter list is a 340px aside with `flex-shrink: 0`, in a row, inside a `100vh` frame with `overflow: hidden`. There is no breakpoint. The page does not scroll sideways; the video is crushed. Locally the same assertion fails.

### High — webhook and cron fail open when their secret is unset (BUG-WEBHOOK, BUG-CRON)

**Where:** code and unit tests. Live currently refuses anonymous calls.

**Steps:** Unset `BIGCOMMERCE_WEBHOOK_SECRET` and `POST /api/webhooks/bigcommerce`. Unset `CRON_SECRET` and `GET` either cron route.

**Expected:** 401 before any order scan or hook write.

**Actual:** `webhookSecretOk` returns true when the secret is missing (`lib/bigcommerce.ts`). Both cron handlers skip the check when `CRON_SECRET` is empty (`app/api/cron/reconcile/route.ts`, `app/api/cron/webhook-watchdog/route.ts`). Reconcile then lists orders and posts to Google Chat. The watchdog then registers or repairs BigCommerce webhooks.

**Live:** With the deployed environment, the empty webhook body, reconcile, and the watchdog all returned 401. The secrets are set in production today. The bug is the unset path, which is silent.

### Medium — the progress headline counts lessons from other courses (BUG-PROGRESS)

**Where:** local. `app/course/[slug]/course-viewer.tsx`.

**Steps:** Complete one lesson in course A and one in course B. Open course A, which has two lessons.

**Expected:** "1 of 2 lessons". The chapter row already shows `1/2`.

**Actual:** The headline uses `completed.size / totalLessons`. `completed` is every `lesson_progress` row for the user, loaded without filtering to this course (`app/course/[slug]/page.tsx`). The seeded case renders "2 of 2" while the chapter button shows 1/2.

**Live:** The test account had no completed lessons, so the opened course showed zero completed. That does not clear the bug; the cross-course case was not present on that account.

### Medium — admin pages overflow a phone width

**Where:** live `/admin` at 390×844.

**Steps:** Sign in, set the viewport to 390×844, open `/admin`, compare `scrollWidth` and `clientWidth`.

**Expected:** The same ≤ 1px overflow the homepage met.

**Actual:** The document was 419px wider than the screen. `.admin-table th` is `white-space: nowrap`, and the only narrow-screen rule reduces cell padding. The top bar also keeps the email and Sign out on one row.

### Medium — homepage clips cannot be paused (BUG-A11Y)

**Where:** local and live. `app/page.tsx`.

**Steps:** Load `/`. Inspect the transformation videos.

**Expected:** A control to pause the motion (WCAG 2.2.2).

**Actual:** Each clip is `autoPlay`, `loop`, `muted`, `playsInline`, and has no `controls` attribute.

### Medium — security headers are absent

**Where:** live `GET /`.

**Actual response:** `strict-transport-security`, `content-security-policy`, `x-frame-options`, `referrer-policy`, and `x-content-type-options` were all missing. `next.config.js` does not set them.

### Medium — dependency advisories

`npm audit` reports 6 vulnerable packages: 3 critical, 2 high, 1 moderate. `next@14.2.x` is inside the affected range for multiple Next.js DoS and React Server Component issues. `nodemailer` and `postcss` are high. `vitest`, `@vitest/mocker`, and `tinypool` are dev-only (path traversal in the mocker, prototype pollution in tinypool). They were not upgraded here; a Next major bump changes runtime behavior and belongs in its own change. Do not use `npm audit fix --force` on this tree.

### Low — password reset says the mail was sent when it was not

**Where:** local, and `app/auth/actions.ts`.

`requestPasswordReset` always returns `{ ok: true }` after a well-formed address, including when `sendPasswordResetEmail` returns `sent: false` (SMTP unset) and when `generateLink` fails. The copy is intentionally the same for unknown addresses. The welcome path does tell staff when mail failed. A student who asks for a reset during an SMTP outage is told to check their inbox.

### Low — reconciliation only sees the first 1,000 accounts (BUG-RECONCILE)

**Where:** `app/api/cron/reconcile/route.ts`.

`listUsers({ page: 1, perPage: 1000 })` runs once. `listStudents` walks pages up to 5,000, and `findUserByEmail` walks further. Past 1,000 students, a paid buyer missing from page one is invisible to the reconciliation report. The school is still under that page size, so this is latent.

### Low — axe landmarks

`/` and `/login` have no `main` landmark. `/login` has 9 nodes outside a landmark region. Impact reported by axe: moderate. Contrast of the brand red `#b50027` on white is about 7:1, and the gold eyebrow `#dead00` on `#141414` is about 8.9:1, so this is structure rather than contrast.

### Low — homepage copy and the README disagree with the app

The homepage steps say "No password needed." The login form defaults to a password, with the one-time link as the other mode.

`README.md` still documents `/demo/dashboard` and `/demo/curso/...`, says progress lives only in the browser, and points access checks at `/curso/[slug]/page.tsx`. Courses are `/course/[slug]`. Progress is stored in `lesson_progress`. Webhooks are checked with `x-evolve-webhook-secret` when that secret is set. The commands in "How to re-run" below are the ones that match this suite.

### Low — the lesson tick shows before the save is confirmed

**Where:** `app/course/[slug]/course-viewer.tsx`, `setDone`.

The tick is added or removed, and then `lesson_progress` is written. The student sees the lesson as saved while that request is still in flight. A reload or navigation during the request cancels it, and the next load shows the previous state. A response that comes back with an error puts the tick back and shows "We could not save that just now". A cancelled request never returns, so that correction does not run.

### Low — sign-in URLs are interpolated into email HTML

Course titles go through `escapeHtml`. `signInUrl` and `loginUrl` are placed raw into `href` in `lib/email.ts` `button()`. Those URLs are built by this app, so this is defense in depth, not an open injection.

## Accepted behavior, not filed as bugs

- Order status 14 (Partially Refunded) counts as paid, on purpose, in `lib/bigcommerce.ts`.
- Unknown SKUs fall back to the line's product id. Product ids differ per store; the SKU map is the supported match.
- `bigcommerce_order_id = 0` is a hand grant.
- There is no pagination control. The student list renders in one table and filters in the browser.
- The recovery cookie is `Secure`, so it will not stick on `http://127.0.0.1`. Production is https.

## Not tested, and why

- No payment, refund, or charge. There is no payment UI, and live writes were out of scope.
- No production create, edit, delete, publish, import, or email. Grant, revoke, course and lesson edits, staff changes, and password changes ran only against the local stand-in.
- The live password form was given a too-short password so the client would reject it. The test account's password was not changed.
- No brute force and no load test.
- Real BigCommerce order fetch, Gmail SMTP, and Google Chat were not exercised. The local webhook test uses an unknown store hash so it stops before BigCommerce. Live cron was only called without the secret, and it returned 401.
- Cross-course progress was not reproduced on the live account because that account had zero completed lessons. Completing a lesson would write `lesson_progress`.
- Google Doc URLs that are not Drive file, open, or `uc` links are not parsed (`lib/lesson-source.ts`). That limit was not given a live lesson.
- A Supabase outage was not simulated. There is no `app/error.tsx` and no `middleware.ts`; a failed `getUser` on a server page would surface as a 500.
- `npm audit` findings were not patched.

## How to re-run

Unit tests. No network, no server:

```bash
npm test
```

Local end-to-end tests. Starts the in-memory stand-in and `next dev` on
`http://127.0.0.1:3000`. This is also what `npm run test:e2e:all` and a bare
`npx playwright test` run. Neither command contacts production, even if
`E2E_ALLOW_PROD` is set in the environment.

```bash
npm run test:e2e
```

Staging end-to-end tests. Points the same write-path suite at an already
running private instance and does not start the dev server. A
`gcloud run services proxy` on port 8080 is the usual shape. The origin
must not be `https://evolve.superhairpieces.com`; the suite exits before
any request if it is. The staging database needs the same fixture accounts
the local stand-in seeds. Set `E2E_RESET_URL` when that instance exposes
the stand-in reset hook, and `E2E_SUPABASE_URL` when the onboarding test
should mint tokens against a staging auth URL instead of the local mock.
`E2E_WEBHOOK_SECRET` is that instance's webhook secret. When it is set, the
suite sends an unknown store hash with the secret and expects 400. That
request does not call BigCommerce. It does post an onboarding-failed notice
when the instance has `GOOGLE_CHAT_WEBHOOK` set. When the variable is unset,
that sub-check is skipped and the unauthenticated 401 checks still run. The
local suite uses the stand-in secret and does not need the variable. The
lesson progress test waits for the `lesson_progress` response before it
reloads, so a slow proxy cannot cancel the save.

```bash
E2E_BASE_URL=http://127.0.0.1:8080 npm run test:e2e:staging
```

Production smoke. Read-only GETs of public pages. It does not call cron,
webhooks, or onboarding, and it does not sign in. Refuses to start unless
the opt-in is set:

```bash
E2E_ALLOW_PROD=1 npm run test:e2e:prod
```

Manual live admin test. Signs in to production with a staff account, reads
screens, and signs out. Skipped unless the opt-in is set. Not part of CI.
Do not commit the email or password.

```bash
E2E_ALLOW_PROD=1 E2E_ALLOW_LIVE_ADMIN=1 \
  E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
  npm run test:e2e:live-admin
```

Lint and typecheck, which CI runs before the suites:

```bash
npm run lint
npm run typecheck
```
