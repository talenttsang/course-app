import { NextResponse } from "next/server";
import { notifyConfigProblem } from "@/lib/notify";

// Shared-secret checks for the endpoints that face the open internet.
//
// Both of these used to read "if no secret is configured, allow it". That is
// convenient on a laptop and wrong in production, where losing the variable
// silently unlocks the door: nothing breaks, nothing logs, the pages serve as
// usual, and the endpoint simply stops being protected.
//
// It matters because of what sits behind them. The reconciliation returns the
// names and email addresses of real customers who paid and have no access.
// The watchdog writes webhooks to BigCommerce. The order webhook sends mail to
// real people. None of that should be one missing variable away from public.
//
// Outside production the permissive behaviour stays, so the thing still runs
// locally without inventing secrets.

function missingIsFatal() {
  return process.env.NODE_ENV === "production";
}

// Constant-time-ish: bail on length, then diff every byte, so how long this
// takes does not reveal how much of the prefix was right.
function matches(got: string | null, expected: string): boolean {
  if (!got || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * Returns a response to send back, or null to carry on.
 *
 * A missing secret in production answers 503, not 401: the caller did nothing
 * wrong and retrying with a different header will not help. It also says so in
 * chat, because an endpoint that has quietly stopped being protected is not
 * something anyone discovers by looking at the site.
 */
export async function requireSharedSecret(opts: {
  variable: string;
  header: string;
  got: string | null;
  endpoint: string;
}): Promise<NextResponse | null> {
  const expected = process.env[opts.variable];

  if (!expected) {
    if (!missingIsFatal()) return null;
    await notifyConfigProblem({
      what: opts.variable,
      detail: `${opts.endpoint} refused every request — without this secret the endpoint would be open to anyone`,
    });
    return NextResponse.json(
      { error: "this endpoint is not configured" },
      { status: 503 }
    );
  }

  if (!matches(opts.got, expected)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  return null;
}
