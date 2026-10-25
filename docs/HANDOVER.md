# Evolve Academy — platform handover

Last verified against the live system: **21 October 2026**.
Owner: Manne (Head of Digital Transformation).

This describes what the platform is, how a student gets in, where everything
lives, and what is still unfinished. It assumes no prior knowledge.

**No passwords, tokens or keys appear here.** It says where each credential
lives; the values are read from there. It lives in the repository rather than
a document so that it is versioned alongside the code it describes — the
previous copy drifted four weeks out of date without anyone noticing.

---

## 1. What this is

Students buy a course on a BigCommerce storefront and this platform gives
them an account and the lessons.

| | |
|---|---|
| Live site | https://evolve.superhairpieces.com |
| Code | github.com/mannetsang/course-webapp |
| Hosting | Cloud Run, project `shp-ai-bot-2026`, region `us-central1` |
| Database and login | Supabase project `ngilonjnqqncxknqvwff` (shp-courses) |
| Outgoing email | Gmail SMTP as sales@superhairpieces.com |
| Team notifications | none — the admin Waiting page (`/admin/waiting`) |
| Scheduled jobs | none |

### Courses

| Course | Lessons | Language | Students |
|---|---|---|---|
| Men's Hair Replacement Specialist: Starter | 57 | English | 12 |
| Men's Hair Replacement Specialist: Extended | 67 | English | 95 |
| Certificado en Prótesis Capilares | 43 | Spanish | 21 |
| Extended course (In Person) | 67 | English | 13 |

Starter is the monofilament lessons. Extended adds poly skin and lace.

### Where the students are

- **105 accounts**, of which **26** have ever signed in
- **141 course grants**: 7 from a store order, 134 granted by hand
- 87 of those by-hand grants are students migrated from the old platform
- **0 lesson-progress rows** — progress only started being saved on 20 Oct

---

## 2. How a student gets access

1. Someone buys a course on a BigCommerce storefront. **Nothing happens
   automatically**: there is no order webhook, no scheduled job, no chat.
2. Staff open `/admin/waiting` and press **Check now**. It reads N days of
   paid orders across every store and lists course buyers with no access.
3. **Onboard** on a row fetches that order with its store's token and checks
   it is paid.
4. It matches line items to courses **by SKU, ignoring capitalisation**.
5. It creates the account if needed, records the buyer's name, grants the course.
6. It emails a welcome with a one-click sign-in link valid 24 hours, in the
   language the course is taught in, and records whether that mail left.

Steps 5–6 are idempotent, so pressing Onboard twice sends one welcome. The
same page lists setup problems (missing tokens, SMTP, `PUBLIC_ORIGIN`) and
students whose welcome email failed. Someone has to check it daily: until
they do, a buyer who has paid has no access.

### Storefronts

| Store hash | Storefront | Currency | Old webhook (delete) | Token |
|---|---|---|---|---|
| `gmosz3ja` | superhairpieces.ca | CAD | 31662661, active | yes |
| `qet21urb3p` | superhairpieces.es | EUR | 31759427, active | yes |
| `cavofu` | superhairpieces.com | USD | 31774202, active | yes |
| `1f8t0plkkw` | superhairpieces.nl | — | **none** | catalogue-read only |
| `1tqjsol232` | superhairpieces.fr | — | **none** | catalogue-read only |
| `34amlu9gm` | superhairpieces.de | — | none | catalogue-read only |

**`.nl` and `.fr` sell courses and onboard nobody.** `.nl` lists three
(`academyStarter` 885, `academyExtended` 886, `academyExtended_in_person`
1114) and `.fr` one (`academyExtended` 2193). Their tokens are catalogue-read
only — orders return 403 — so the Waiting page cannot see them. This is the same position `.com` was in when a paying buyer sat
unonboarded for weeks. **Highest-value open task:** get tokens with
order-read scope for both.

### Why matching is by SKU

Product ids are per-store, and so is their capitalisation:

| SKU | .ca | .es | .com | .nl | .fr |
|---|---|---|---|---|---|
| academyStarter | 3463 | — | 7019 | 885 | — |
| academyExtended | 3464 | — | 7020 | 886 | 2193 |
| academyExtended Spanish | 3827 | 3848 | 7447 | — | — |
| academyExtended_In_Person | 3986 | — | 7623 | 1114 | — |

The internal id used everywhere else is the **.ca** one. `.ca` spells the
in-person course `academyExtended_In_Person`; `.com` and `.nl` use lowercase.
Matching lower-cases both sides. Adding a course, or selling an existing one
on a new storefront, means adding the SKU to `lib/bigcommerce.ts`.

### Which orders count as paid

Shipped (2), Partially Shipped (3), Awaiting Pickup (8), Awaiting Shipment
(9), Completed (10), Awaiting Fulfillment (11), Partially Refunded (14).

Partially Refunded is deliberate: store credit towards a course lands there.
The list was once only 10 and 11, so a paid, shipped $1,204 order read as
unpaid and the buyer got nothing.

**Open question:** all three stores rename status 13 (system name "Disputed")
to **"Processing / Producing"**, and 951 orders sit in it. It is not on the
paid list. No course order has ever been in it, so nothing has been lost —
but if that status means "paid and being made", it should be added.

---

## 3. What runs on a schedule

Nothing. The webhook watchdog and weekly reconciliation were removed along
with the order webhook and Google Chat. The reconciliation now runs on demand
from `/admin/waiting`. Delete the `evolve-webhook-watchdog` and
`evolve-weekly-reconcile` Cloud Scheduler jobs, and the order webhooks on
each store listed above.

---

## 4. Signing in

`/admin` while signed out redirects to `/login?next=<page>` and returns you
there afterwards. Signed in but not staff is a different screen, naming the
account and offering a way back — not a login form you have already used.

**Owners** come from `ADMIN_EMAILS` on the Cloud Run service and cannot be
removed through the interface. Currently manne@.

**Staff** live in the `admins` table: daniela@, cindy@, jalen@, vidusion@,
philip@, tian@, ryan.l@, lidia@, and grok-test@ (a test account — remove it
when testing ends).

Adding staff creates their account, grants **every course**, and emails them
a sign-in link. Each row has **Resend invite**, because links last 24 hours.

---

## 5. Looking after a student

Admin → Students → a student shows: when they joined, last sign-in, whether
they have a password, and **whether a welcome email was ever sent**. A
student with access and no welcome has paid and does not know.

- **Resend sign-in link** — a fresh 24-hour link with the full welcome.
- **Change email** — for a typo'd address at checkout. Course access follows
  the account, not the address, so nothing is lost. The old address is kept
  on the account, and the welcome record is cleared, because a message sent
  to an address that was never theirs is not a message they received.
- **Give someone access by hand** — for phone sales, comped places, or a
  buyer who paid with a different email. Reports honestly whether mail left.

For batches, `POST /api/admin/onboard` does the same over HTTP, authenticated
with an admin's own Supabase token.

---

## 6. Where everything lives

### Cloud Run configuration

**None of these are in the repository and none should be.**

| Variable | What it is |
|---|---|
| SUPABASE_SERVICE_ROLE_KEY | full database access; server-side only |
| BIGCOMMERCE_STORES | JSON of store hash → API token |
| BIGCOMMERCE_STORE_HASH / _ACCESS_TOKEN | the original single store; superseded |
| PUBLIC_ORIGIN | what we tell customers; pins links in emails |
| ADMIN_EMAILS | permanent owner logins |
| SMTP_* | Gmail SMTP for student email |

Credentials also live in Secret Manager under
`BIGCOMMERCE_<store_hash>_<FIELD>` for all six storefronts.

### Deployment

For Render, see `docs/RENDER.md`.

Pushing to `main` deploys to production in about three minutes. Cloud Build
trigger **CICD** (in the *global* region) builds `cloudbuild.yaml`.

- The trigger must use `cloudbuild.yaml`, not "Autodetected". On autodetect it
  ships a bundle with no Supabase URL and reports success.
- Substitutions `_NEXT_PUBLIC_SUPABASE_URL` and `_NEXT_PUBLIC_SUPABASE_ANON_KEY`
  must be set; they are baked in at build time and fail the same silent way.

`.github/workflows/ci.yml` runs typecheck, tests and build on every push and
pull request. **It reports; it does not gate the deploy.** Cloud Build
triggers on the same push independently.

### Email

Gmail SMTP with an app password, not Supabase's mailer, which caps at two
emails an hour. Built in `lib/email.ts`. Two rules learned painfully: every
coloured cell needs a `bgcolor` attribute as well as CSS, and the logo must
be a PNG because Gmail and Outlook do not render SVG.

Four wordings, chosen automatically: **purchase**, **migration** (course has
moved), **granted** (given a course), **staff** (given the keys — no course
list when there is nothing to list).

---

## 7. Security posture

- `course_videos` is readable **only by someone who owns the course**. It was
  `using (true)` until 21 Oct, which made all 234 lesson source ids readable
  with the public anon key — an unlisted YouTube id is the video.
- `purchases`, `lesson_progress` and `admins` are owner-scoped or
  service-role only.
- `?next` on sign-in accepts only same-site absolute paths; `//evil.example`,
  full URLs and `/\evil.example` are rejected in login and both auth callbacks.
- Password reset links are built from `PUBLIC_ORIGIN`, never a request header.
- Supabase requires re-authentication to change a password.
- There are no webhook or cron endpoints. Onboarding is a staff-only server
  action, and it reads the order from BigCommerce rather than trusting the page.

---

## 8. Known gaps

- **`.nl` and `.fr` sell courses and onboard nobody.** See §2.
- **Two things still live in code that belong in the database**: course
  language (`lib/i18n.ts`) and SKU → course (`lib/bigcommerce.ts`). A
  Supabase token is available now, so these are unblocked.
- **`purchases` does not record which store an order came from.** Order
  numbers are per-store and could collide.
- **The website interface is English only.** Only emails are translated.
- **CI reports but does not gate.** A red build still deploys.
- **Deliverability unverified.** 26 of 105 accounts have signed in.
- **Nadine Sparks has two accounts**, nadine@ and hello@unityhairservices.com.
- **`ocallaghancutz@gmail.co`** is a typo'd address with no order and no name
  recorded, so the real address cannot be recovered from the system.
- **A migration to GCP project `shp-evolve` is built and tested** but not cut
  over. It waits on a GitHub connection in that project's Cloud Build console.
- **Credentials to rotate**: the Gmail app password. Delete the now-unused
  Google Chat webhook, `CRON_SECRET` and `BIGCOMMERCE_WEBHOOK_SECRET`.
- **Next.js 14.2.5** carries published advisories.

## 9. Things that look like bugs but are not

- **A grant recorded as order 0** was given by hand, not bought. 134 of 141.
- **An order "Awaiting Payment" produces nothing.** Correct.
- **An admin cannot see a course they were not granted.** Admin and student
  access are separate — though staff are now granted everything on invite.
- **A buyer stays on the Waiting page after Onboard.** Only until the page is
  checked again: the list is a snapshot from when Check now was pressed.
