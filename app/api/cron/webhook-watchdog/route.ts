import { NextRequest, NextResponse } from "next/server";
import { storeTokens } from "@/lib/bigcommerce";
import { notifyWebhookRepaired, notifyWatchdogFailed } from "@/lib/notify";
import { webhookOrigin } from "@/lib/origin";
import { requireSharedSecret } from "@/lib/require-secret";

// Makes sure every storefront's order webhook is registered and switched on.
//
// BigCommerce deactivates a webhook by itself once deliveries have been
// failing for 48 hours: is_active goes false and stays false until somebody
// turns it back on. A disabled webhook doesn't error — it simply never fires
// — so every course sale after that is lost in silence, and no alert can
// come from the thing that isn't running. That is how a paying customer sat
// unonboarded for 25 days.
//
// Repairing is deliberately noisy. Needing a repair means deliveries were
// failing for two days, and orders placed in that window are NOT replayed by
// re-enabling — they have to be found by reconciling paid orders against
// granted access. Fixing this quietly would hide both facts.

export const dynamic = "force-dynamic";

const SCOPE = "store/order/statusUpdated";

// A rate-limited or briefly unavailable store is not a failure worth waking
// anyone for: the next run is fifteen minutes away and will see the truth.
// Alerting on a single blip trains people to ignore the alert, which costs
// us the one that matters.
//
// A rejected token is the opposite. It does not heal, every order on that
// storefront is failing meanwhile, and it has already happened once — so
// 401 and 403 are never retried and never softened.
const TRANSIENT_ATTEMPTS = 3;

function isTransient(status: number) {
  return status === 429 || status >= 500;
}

async function bcFetch(url: string, init: RequestInit): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 1; attempt <= TRANSIENT_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { ...init, cache: "no-store" });
      if (res.ok || !isTransient(res.status)) return res;
      last = res;
    } catch (err) {
      // A dropped connection is as transient as a 503 and deserves the
      // same patience; the last attempt rethrows it.
      if (attempt === TRANSIENT_ATTEMPTS) throw err;
    }
    if (attempt < TRANSIENT_ATTEMPTS) {
      const reset = Number(last?.headers.get("x-rate-limit-time-reset-ms"));
      const wait = Number.isFinite(reset) && reset > 0 ? Math.min(reset, 15_000) : attempt * 2_000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return last!;
}

type Hook = {
  id: number;
  scope: string;
  destination: string;
  is_active: boolean;
  headers?: Record<string, string> | null;
};

export async function GET(req: NextRequest) {
  // Cloud Scheduler is the only caller. Without a secret this is a public
  // URL that anyone could hammer, and it writes to BigCommerce.
  const refused = await requireSharedSecret({
    variable: "CRON_SECRET",
    header: "x-evolve-cron-secret",
    got: req.headers.get("x-evolve-cron-secret"),
    endpoint: "the webhook watchdog, which writes webhooks to BigCommerce",
  });
  if (refused) return refused;

  const destination = `${webhookOrigin(req.headers)}/api/webhooks/bigcommerce`;
  const secret = process.env.BIGCOMMERCE_WEBHOOK_SECRET;
  const stores = storeTokens();

  const results: Record<string, string> = {};
  let repaired = 0;

  for (const [storeHash, token] of Object.entries(stores)) {
    try {
      const action = await ensureHook(storeHash, token, destination, secret);
      results[storeHash] = action;
      if (action !== "ok") {
        repaired++;
        await notifyWebhookRepaired({ storeHash, action });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      results[storeHash] = `error: ${reason}`;
      // Being unable to check is itself worth knowing — it is the state in
      // which a dead webhook would go unnoticed.
      await notifyWatchdogFailed({ storeHash, reason });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: Object.keys(stores).length,
    repaired,
    results,
  });
}

async function ensureHook(
  storeHash: string,
  token: string,
  destination: string,
  secret: string | undefined
): Promise<string> {
  const api = `https://api.bigcommerce.com/stores/${storeHash}/v3/hooks`;
  const headers = {
    "X-Auth-Token": token,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const res = await bcFetch(api, { headers });
  if (!res.ok) {
    throw new Error(
      isTransient(res.status)
        ? `could not list hooks: ${res.status} after ${TRANSIENT_ATTEMPTS} attempts`
        : `could not list hooks: ${res.status}`
    );
  }
  const hooks: Hook[] = (await res.json())?.data ?? [];

  const body = JSON.stringify({
    scope: SCOPE,
    destination,
    is_active: true,
    ...(secret ? { headers: { "x-evolve-webhook-secret": secret } } : {}),
  });

  const mine = hooks.find((h) => h.scope === SCOPE && h.destination === destination);

  if (!mine) {
    const created = await bcFetch(api, { method: "POST", headers, body });
    if (!created.ok) throw new Error(`could not create hook: ${created.status}`);
    return "recreated — it was missing entirely";
  }

  // Also repair a hook that is on but has lost its secret header: it would
  // be rejected by the endpoint on every delivery, which is the fast route
  // back to BigCommerce deactivating it again.
  const secretMissing = Boolean(secret) && !mine.headers?.["x-evolve-webhook-secret"];

  if (!mine.is_active || secretMissing) {
    const updated = await bcFetch(`${api}/${mine.id}`, { method: "PUT", headers, body });
    if (!updated.ok) throw new Error(`could not update hook: ${updated.status}`);
    return mine.is_active
      ? "secret header restored"
      : "re-enabled — BigCommerce had switched it off";
  }

  return "ok";
}
