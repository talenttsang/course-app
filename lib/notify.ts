// Operational updates to the team's Google Chat space.
//
// The webhook URL carries its own key and token, so it IS a credential —
// anyone holding it can post to the space. It lives in the
// GOOGLE_CHAT_WEBHOOK env var on the Cloud Run service, never in the repo.
// With the var unset this becomes a no-op, so local runs and any future
// environment stay silent instead of failing.
//
// Everything here is fire-and-forget. A student's access must never depend
// on a chat service being reachable: the notify call is awaited only so the
// serverless container isn't torn down mid-request, and failures are logged
// rather than raised.

import { describeError } from "@/lib/redact";

const TIMEOUT_MS = 5000;

export function chatConfigured() {
  return Boolean(process.env.GOOGLE_CHAT_WEBHOOK);
}

async function post(text: string): Promise<void> {
  const url = process.env.GOOGLE_CHAT_WEBHOOK;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      // Without this, Next caches the request and repeated alerts from a
      // route collapse into one: five refused calls to a cron endpoint
      // produced a single message, while the webhook — reached by POST, so
      // never cached — reported every one. An alarm that reports an attack
      // once is worse than one that reports it five times.
      cache: "no-store",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // The body is whatever the far end chose to send back. Redacted like
      // anything else we did not write.
      const body = describeError(new Error(await res.text()), [url]);
      console.error(`[notify] chat rejected the message: ${res.status} ${body}`);
    }
  } catch (err) {
    // Deliberately NOT the message. The webhook URL carries its own key and
    // token, and when it is malformed Node says "Failed to parse URL from
    // <the whole thing>" -- which would put the credential in Cloud Run's
    // logs, from the one function whose job is to report problems safely.
    // The type and code say what went wrong; the message adds nothing here
    // that is worth that risk.
    const code = (err as { code?: unknown })?.code;
    const kind = err instanceof Error ? err.name : typeof err;
    console.error(
      `[notify] could not reach chat: ${kind}${typeof code === "string" && code ? ` (${code})` : ""}`,
    );
  }
}

// Google Chat reads *bold* / _italic_ / `code` in plain text messages. An
// address or course title could contain those characters and quietly mangle
// the formatting of the whole line, so escape anything we interpolate.
// Strips the characters Google Chat reads as formatting, so interpolated
// text cannot mangle a message.
//
// Underscores are deliberately kept. Stripping them turned CRON_SECRET into
// CRONSECRET in the very alert whose job is to name the missing setting —
// sending whoever reads it at 2am looking for a variable that exists nowhere.
// An unpaired underscore does nothing in Chat; a pair would italicise, which
// is a cosmetic risk worth taking to keep an identifier readable.
function safe(value: string) {
  return value.replace(/[*`~]/g, "");
}

export type OnboardSource = "store" | "admin-api" | "admin-ui";

const SOURCE_LABEL: Record<OnboardSource, string> = {
  store: "BigCommerce order",
  "admin-api": "onboarding endpoint",
  "admin-ui": "admin portal",
};

// A student got access to something. The single event the team actually
// wants to see: someone paid, and they can now get in.
export async function notifyOnboarded(opts: {
  email: string;
  courseTitles: string[];
  source: OnboardSource;
  newAccount: boolean;
  emailed: boolean;
  emailError?: string;
  orderId?: number | string;
}) {
  const lines = [
    `🎓 *${opts.newAccount ? "New student" : "Course added"}* — ${safe(opts.email)}`,
    ...opts.courseTitles.map((t) => `• ${safe(t)}`),
  ];

  const via = SOURCE_LABEL[opts.source];
  lines.push(opts.orderId ? `_via ${via} ${safe(String(opts.orderId))}_` : `_via ${via}_`);

  // The part that needs a human: they have paid, have access, and have no
  // idea. Say so loudly rather than burying it.
  lines.push(
    opts.emailed
      ? "✉️ Welcome email sent."
      : `⚠️ *Welcome email NOT sent${opts.emailError ? ` — ${safe(opts.emailError)}` : ""}.* ` +
          "They have access but have not been told. Someone needs to contact them.",
  );

  await post(lines.join("\n"));
}

// A paid order arrived that we could not act on. Silent failures here are
// how a paying customer ends up waiting indefinitely.
export async function notifyOnboardFailed(opts: {
  email?: string;
  reason: string;
  orderId?: number | string;
}) {
  await post(
    [
      "🚨 *Onboarding failed*",
      opts.email ? `Buyer: ${safe(opts.email)}` : "Buyer: unknown",
      opts.orderId ? `Order: ${safe(String(opts.orderId))}` : null,
      `Reason: ${safe(opts.reason)}`,
      "This buyer has NOT been given access.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

// Used to confirm the wiring end to end without inventing a fake student.
export async function notifyTest(message: string) {
  await post(`🔔 ${safe(message)}`);
}

// The watchdog had to repair a webhook. This is never routine: BigCommerce
// only switches one off after deliveries have failed for 48 hours, and
// re-enabling does NOT replay the orders that arrived meanwhile. Say both
// things, because the repair is the smaller half of the problem.
export async function notifyWebhookRepaired(opts: { storeHash: string; action: string }) {
  await post(
    [
      "🔧 *Order webhook repaired*",
      `Store: ${safe(opts.storeHash)}`,
      `Action: ${safe(opts.action)}`,
      "",
      "*Course sales may have been missed while it was off, and re-enabling " +
        "does not recover them.* Reconcile paid course orders against granted " +
        "access for the period it was down.",
    ].join("\n"),
  );
}

// Unable to check is the state in which a dead webhook goes unnoticed, so it
// is reported rather than retried silently until someone happens to look.
export async function notifyWatchdogFailed(opts: { storeHash: string; reason: string }) {
  await post(
    [
      "⚠️ *Could not check the order webhook*",
      `Store: ${safe(opts.storeHash)}`,
      `Reason: ${safe(opts.reason)}`,
      "While this persists, a disabled webhook would not be detected.",
    ].join("\n"),
  );
}

// The weekly reconciliation result.
//
// Posts even when nothing is wrong. A job that only speaks on bad news reads
// exactly like a job that has stopped running — which is the failure this
// whole mechanism exists to catch, so its own silence must never be
// ambiguous.
export async function notifyReconciliation(opts: {
  days: number;
  ordersScanned: number;
  courseOrders: number;
  missing: { store: string; order: number; date: string; email: string; productId: number }[];
  unmatched?: { store: string; order: number; productId?: number; sku?: string; name?: string }[];
  storeErrors: string[];
  storesChecked: string[];
}) {
  const lines: string[] = [];

  if (opts.missing.length === 0) {
    lines.push("✅ *Weekly check: every course buyer has their course*");
  } else {
    lines.push(`🚨 *${opts.missing.length} course buyer(s) paid but have NO access*`);
  }

  lines.push(
    `Last ${opts.days} days · ${opts.ordersScanned} orders scanned · ` +
      `${opts.courseOrders} contained a course · stores: ${opts.storesChecked.join(", ")}`,
  );

  if (opts.missing.length) {
    lines.push("");
    for (const m of opts.missing.slice(0, 20)) {
      lines.push(
        `• order ${safe(String(m.order))} (${safe(m.store)}) — ${safe(m.email || "no email")} ` +
          `— product ${m.productId} — ${safe(m.date.slice(0, 16))}`,
      );
    }
    if (opts.missing.length > 20) lines.push(`…and ${opts.missing.length - 20} more`);
    lines.push("");
    lines.push("They have paid and are waiting. Onboard them from the admin portal.");
  }

  // Every unmatched line, not a sample. The weekly summary is the one place
  // these are guaranteed to be read, and a throttled alert inside a ten-day
  // scan would show one of them and drop the rest.
  const unmatched = opts.unmatched ?? [];
  if (unmatched.length) {
    lines.push("");
    lines.push(`❓ ${unmatched.length} line(s) looked like a course but could not be matched:`);
    for (const u of unmatched.slice(0, 20)) {
      lines.push(
        `• order ${safe(String(u.order))} (${safe(u.store)}) — product ${u.productId ?? "?"} ` +
          `— sku ${safe(u.sku ?? "none")} — ${safe(u.name ?? "unnamed")}`,
      );
    }
    if (unmatched.length > 20) lines.push(`…and ${unmatched.length - 20} more`);
    lines.push(
      "Each is either an ordinary product sharing an id with a course — nothing granted, " +
        "nothing wrong — or a course whose SKU has changed, in which case that buyer has NO access.",
    );
  }

  if (opts.storeErrors.length) {
    lines.push("");
    lines.push(`⚠️ Could not fully check: ${safe(opts.storeErrors.join("; "))}`);
    lines.push("Buyers on those stores may be missing from this list.");
  }

  await post(lines.join("\n"));
}

// One alert per key per window, shared by callers that can fire repeatedly.
// A storefront can book several orders a minute, and an alert that arrives
// once per order is an alert nobody reads. Best effort only: this counts per
// container, so several Cloud Run instances can still raise one each.
const ONCE_WINDOW_MS = 15 * 60 * 1000;
const lastSentAt = new Map<string, number>();

export async function notifyOnce(key: string, send: () => Promise<void>) {
  const now = Date.now();
  if (now - (lastSentAt.get(key) ?? 0) < ONCE_WINDOW_MS) return;
  lastSentAt.set(key, now);
  await send();
}

// An order contained something that matches one of our courses but carries a
// SKU we do not know, on a storefront whose product ids are not ours to read.
//
// This is deliberately ambiguous, because the data is: the same shape means
// either "a customer bought an unrelated product that happens to share an id
// with a course" (nothing to do) or "a course SKU changed and a real buyer
// got nothing" (urgent). Saying which would be guessing, so it says both and
// gives whoever reads it the product name, which settles it instantly.
export async function notifyUnmappedCourseSku(opts: {
  storeHash: string;
  orderId: number | string;
  lines: { product_id?: number; sku?: string; name?: string }[];
}) {
  await post(
    [
      "❓ *An order looked like a course but could not be matched*",
      `Store: ${safe(opts.storeHash)} · order ${safe(String(opts.orderId))}`,
      ...opts.lines.map(
        (l) => `• product ${l.product_id ?? "?"} · sku ${safe(l.sku ?? "none")} · ${safe(l.name ?? "unnamed")}`,
      ),
      "",
      "If that is an ordinary product that happens to share an id with a course, " +
        "nothing is wrong and nothing was granted. If it is a course whose SKU has " +
        "changed, the buyer has NOT been given access and the SKU map needs updating.",
    ].join("\n"),
  );
}

// A setting is missing or wrong in a way that stops real work.
//
// This exists because the failure it reports is otherwise invisible: the site
// keeps serving, the page says what it always says, and only the thing that
// did not happen is different. Someone has to be told.
// `note` replaces the closing line. The default is true of a missing
// setting and false of anything else: a mailer that refused one recipient
// will not "keep happening", and nothing needs restoring, so a caller whose
// failure is not a setting says what is actually the case instead of
// sending whoever reads it at 2am hunting a variable that is fine.
export async function notifyConfigProblem(opts: { what: string; detail: string; note?: string }) {
  await post(
    `*Configuration problem*\n` +
      `Setting: ${safe(opts.what)}\n` +
      `Effect: ${safe(opts.detail)}\n` +
      safe(opts.note ?? "Nothing was sent. This will keep happening until the setting is restored.")
  );
}
