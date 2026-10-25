# Evolve Academy (course-webapp) — Agent Instructions

## Agent Behavior

- Do not announce that you have read this file. Only reference it when relevant.
- If you believe something is correct, say "correct."
- If you believe something is wrong, say "wrong." Do not side with the user just to agree.

## Git

- Whenever you complete a piece of work (new feature, fix, config change), commit it — don't leave finished work uncommitted. Then push to GitHub.
- Never commit secrets: tokens, webhook URLs, service-account keys, `.env` files. Config with secrets goes in env vars on the Cloud Run service, not the repo.
- **Pushing to `main` deploys to production.** The Cloud Build trigger `CICD` builds and deploys on every push. There is no staging. Run `npm run build` before you push.

---

## What this is

The online course platform for Superhairpieces' hair replacement training
(Evolve Academy). Students buy a course on a BigCommerce storefront and this
app gives them an account and the lessons.

- Live: https://evolve.superhairpieces.com
- Next.js 14 App Router, `output: "standalone"`, deployed to Google Cloud Run
  (project `shp-ai-bot-2026`, region `us-central1`, service `course-webapp`)
- Supabase for auth and data (project `ngilonjnqqncxknqvwff`)
- Email via Gmail SMTP as sales@superhairpieces.com

Full handover document, including current state and open questions:
Google Drive → Claude Projects → "Evolve Academy — Platform Handover".

### Layout

| Path | What lives there |
|---|---|
| `app/api/webhooks/bigcommerce/` | the automatic onboarding path — a paid order becomes an account |
| `app/api/admin/onboard/` | the same thing over HTTP, for orders no webhook will ever see |
| `app/admin/` | staff area: courses, lessons, students, staff |
| `lib/bigcommerce.ts` | multi-store credentials, SKU→course map, webhook secret |
| `lib/i18n.ts` | which course is taught in which language, and all email copy |
| `lib/email.ts` | the welcome and password-reset emails |
| `lib/onboarding.ts` | shared by both onboarding paths so they can't drift |
| `lib/notify.ts` | Google Chat alerts |
| `lib/admin.ts` | who is staff; both layers fail closed |

---

## Things that will bite you

**Product IDs are per-store; SKUs are not.** The Spanish certificate is
product 3827 on one storefront and 3848 on another. Match courses by SKU.
Adding a course, or selling an existing one on a new storefront, means
updating the map in `lib/bigcommerce.ts` — miss it and buyers of that course
are silently never onboarded.

**`NEXT_PUBLIC_*` values are inlined at build time**, not read at runtime.
They come from Cloud Build trigger substitutions. If they are empty the build
still succeeds and ships an app whose login page cannot reach Supabase at
all. Nothing alerts on this. The trigger must use `cloudbuild.yaml`, never
"Autodetected", for the same reason.

**Cloud Run terminates TLS upstream.** `request.url` gives you the container
address (`0.0.0.0:8080`), so every redirect must be built from
`publicOrigin()`, which reads `x-forwarded-host`.

**Admin access and student access are separate.** Being staff grants no
courses; holding a course grants no admin. Neither implies the other, and
this surprises people.

**Access granted without telling the buyer is the worst outcome.** Worse than
an error, because nothing surfaces it — they have paid and are waiting.
Every path that grants access must either email them or say loudly that it
didn't. Keep it that way.

**`bigcommerce_order_id = 0` means "granted by hand"**, not a bug. It is how
a real sale is told apart from a manual or comped grant.

**Emails need `bgcolor` attributes as well as CSS**, or some mobile clients
drop the background and leave white text on white. The logo must be a PNG;
Gmail and Outlook do not render SVG.

**Supabase's built-in mailer caps at 2 emails/hour** on the free plan, which
is why we send through our own SMTP. Don't route student email back through
Supabase.

## Known shortcuts

Three things live in code that belong in the database, because adding a
column needs a Supabase personal access token that wasn't available. If you
get one, move them and delete the maps:

- course language (`lib/i18n.ts`) → a `courses.locale` column
- SKU → course (`lib/bigcommerce.ts`) → a `course_products` table
- which store an order came from → a `store_hash` column on `purchases`
