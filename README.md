# Course platform

## Testing

Unit tests cover the pure helpers (SKU matching, paid statuses, lesson links,
email rendering, sign-in redirects) and the authorisation gates on the webhook,
manual onboard, and cron routes. They do not need a database.

```bash
npm test
```

A few tests are marked as known failures (`it.fails` / `test.fail`). They
describe bugs that are still in the product. The suite stays green while those
bugs exist, and goes red when a bug is fixed and the marker has not been
removed. See `QA_REPORT.md` for the list.

Local browser tests boot an in-memory stand-in for Supabase and a dev server.
Accounts in that stand-in are fake. Nothing there talks to production.

```bash
npx playwright install chromium   # once
npm run test:e2e
```

Read-only browser tests against the live site:

```bash
npm run test:e2e:live
```

That command never creates, edits, or deletes production data. It does request
the public pages and checks that admin URLs and admin APIs reject an anonymous
caller. The live admin walk-through is skipped unless both of these are set in
the environment, and it only signs in, reads screens, and signs out:

```bash
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e:live
```

Do not commit those values, and do not point the live command at a script that
submits admin forms. Write paths are covered by `npm run test:e2e` only.
The live admin project turns screenshots, traces, and video off, because
those pages show real students.

The demo URLs further down (`/demo/dashboard`, `/demo/curso/...`) are not in
the current app. Courses live at `/course/[slug]`.

## How it works

1. Someone buys a course on BigCommerce. Nothing happens automatically:
   there is no order webhook.
2. Staff open `/admin/waiting` and press **Check now**. It reads the paid
   orders of the last N days from every store and lists course buyers
   who have no access yet (`lib/reconcile.ts`).
3. **Onboard** on a row reads that order back from BigCommerce, matches
   its products against the `courses` table by SKU, creates (or finds)
   the user in Supabase by email, grants access by inserting a row into
   `purchases`, and emails a welcome with a sign-in link
   (`lib/order-onboarding.ts`).
4. The student goes to `/login`, enters their email, gets a
   passwordless link, and lands on `/dashboard`, seeing only the
   courses they purchased.
5. Every lesson lives as an unlisted YouTube video. Access is checked
   server-side (`/curso/[slug]/page.tsx`): if there's no matching
   purchase, the video ID never reaches the browser.

## Adding a new course

No code changes required:
1. Create the product in BigCommerce, copy its `product_id`.
2. Insert a row into Supabase's `courses` table with that
   `product_id`, the `slug` (used in the URL), and the title.
3. Upload the video to YouTube as "unlisted," restrict its embed to
   the site's domain (Video > Details > Restrictions), and copy the
   ID (the part after `v=` in the URL).
4. Insert a row into `course_videos` per lesson: `course_id`, `title`,
   `youtube_video_id`, `module_title` (the chapter it belongs to, e.g.
   "Lighting basics"), and `position` (its order within that chapter).
   Shows up immediately, no redeploy needed.

## Viewing a local demo, with zero setup

To just see how the screens look, without creating any Supabase or
BigCommerce accounts yet:

```bash
npm install
npm run dev
```

Then open in the browser:
- `http://localhost:3000/demo/dashboard`
- `http://localhost:3000/demo/curso/fotografia-producto`

These routes use fake data and don't check purchases or login — they
exist only to preview the design. The real routes (`/dashboard`,
`/curso/[slug]`, `/login`) need Supabase configured, covered in the
next section.

## Setup

1. Create a project at [supabase.com](https://supabase.com), run
   `supabase/schema.sql` in the SQL editor.
2. Copy `.env.example` to `.env.local` and fill in the variables.
3. In BigCommerce: Settings > API Accounts > create an API account
   per store with read access to Orders and Products. The tokens go in
   `BIGCOMMERCE_STORES` as `{"<store hash>":"<token>"}`.
4. Check the `PAID_STATUS_IDS` set in `lib/bigcommerce.ts` — it needs
   to match the order statuses your store uses for "payment confirmed."
5. In YouTube Studio, for each video: Details > Restrictions >
   restrict the embed to the final site's domain only. This is what
   stops someone from taking the link and reusing it on another page.
   No free option prevents screen recording — this raises the bar, it
   doesn't remove it.
6. `npm install && npm run dev`

## What's missing for production (not included in this scaffold)

- Transactional email when a new user account is created (a "set your
  password" link, or just relying on the magic link going forward).
- Refund/cancellation handling (revoking access if BigCommerce reports
  a refund).
- Per-lesson "completed" tracking — today it only lives in browser
  state (resets on refresh). Needs a `progress` table in Supabase to
  persist.
