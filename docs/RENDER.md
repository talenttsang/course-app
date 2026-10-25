# Deploying on Render

The app ships as a Docker image (`Dockerfile`), so Render builds and runs it
as a **Docker web service**. No code changes are needed.

There is no BigCommerce webhook, no scheduled job and no team chat. Nothing
calls the app from outside, so Render needs no cron jobs and BigCommerce
needs no webhook registered. Sales are onboarded by staff from
`/admin/waiting`.

## 1. Create the service

1. Render → **New → Web Service** → connect `talenttsang/course-app`.
2. **Runtime: Docker.** Render finds `Dockerfile` at the repo root.
3. **Branch:** `main`.
4. **Instance:** a paid instance. The Waiting page's check reads every paid
   order in the window from BigCommerce and can take a few minutes, and a
   free instance can be restarted under it. A free instance also sleeps when
   idle, so the first visit is slow.
5. **Health check path:** `/login`.

## 2. Environment variables

Set these under **Environment**. Copy the values from the current Cloud Run
service (`course-webapp` in `shp-ai-bot-2026`, Variables & Secrets tab).

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. **Needed at build time.** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key. **Needed at build time.** |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key. Secret. |
| `BIGCOMMERCE_STORES` | `{"<store hash>":"<API token>", …}`, one per storefront. Read by the Waiting page. Secret. |
| `COURSE_CATALOGUE_STORE` | Optional. The store whose product ids the `courses` table uses. Defaults to `gmosz3ja`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Gmail SMTP for welcome and reset emails. `SMTP_PASS` is secret. |
| `ADMIN_EMAILS` | Comma-separated owner addresses. Empty means nobody is staff. |
| `PUBLIC_ORIGIN` | `https://evolve.superhairpieces.com`. Without it, welcome emails cannot carry a sign-in link and are not sent. |
| `PORT` | `8080`, to match the Dockerfile. |

Render passes environment variables to a Docker build as build args, and
the Dockerfile declares both `NEXT_PUBLIC_*` values as `ARG`, so they are
inlined into the browser bundle. **If they are missing, the build still
succeeds** and ships a login page that cannot reach Supabase. Set them
before the first deploy, and redeploy after changing them; a restart is
not enough.

These are no longer used; do not set them: `BIGCOMMERCE_WEBHOOK_SECRET`,
`CRON_SECRET`, `WEBHOOK_ORIGIN`, `GOOGLE_CHAT_WEBHOOK`.

## 3. Domain and Supabase

1. Render → service → **Settings → Custom Domains** → add
   `evolve.superhairpieces.com`, then point DNS at the target Render shows.
2. Supabase → **Authentication → URL Configuration**: Site URL
   `https://evolve.superhairpieces.com`, and keep it in the redirect URLs.

## 4. Check it

1. `https://<service>.onrender.com/login` loads, and signing in works.
2. Sign in as staff, open `/admin/waiting`: the **Setup problems** box
   should not appear. If it does, it names the missing setting.
3. Press **Check now**: it should list orders scanned with no store errors.

## 5. Cut over from Cloud Run

- In BigCommerce, delete the order webhooks pointing at
  `/api/webhooks/bigcommerce` on every store. The route no longer exists,
  so they would only fail and get disabled.
- In Cloud Scheduler (`shp-ai-bot-2026`), delete the jobs that call
  `/api/cron/reconcile` and `/api/cron/webhook-watchdog`.
- Disable the Cloud Build trigger `CICD`, or every push to `main` also
  deploys to Cloud Run.
- Render's auto-deploy does not run the checks `cloudbuild.yaml` ran
  (`npm audit`, typecheck, tests). To keep that gate, turn **Auto-Deploy**
  off and call the service's **Deploy Hook** from GitHub Actions after CI
  passes.

## Day to day

Course sales are not onboarded by themselves. Someone has to open
`/admin/waiting` and press **Check now**, then **Onboard** on each buyer
listed. Until they do, a buyer who has paid has no access. Check at least
daily. The same page lists students who have a course but whose welcome
email failed.
