// Where this app tells the world it lives.
//
// Every sign-in link we email is built from an origin, and until now that
// origin came from the request that happened to trigger the send. That is
// fine while there is exactly one way in, and wrong the moment there are
// two: staff onboarding a buyer from the service's own *.onrender.com or
// run.app URL would email the student a sign-in link on that host, which works but looks like a phishing
// attempt and stops looking like us.
//
// PUBLIC_ORIGIN pins it. Set it to the customer-facing address and every
// email says that, however the request arrived. Left unset, behaviour is
// exactly as before, so nothing changes until somebody sets it.

function configured(): string | null {
  const raw = (process.env.PUBLIC_ORIGIN ?? "").trim();
  if (!raw) return null;
  // A trailing slash would produce "https://host//login" in every link.
  return raw.replace(/\/+$/, "");
}

function fromHeaders(host: string | null, proto: string | null): string {
  return `${proto ?? "https"}://${host ?? ""}`;
}

// Raised when a link that will be emailed cannot be built from configuration.
// Carried as its own type so callers can tell a misconfiguration apart from a
// mail-server failure and say something useful about it.
export class MissingPublicOrigin extends Error {
  constructor() {
    super(
      "PUBLIC_ORIGIN is not set. Refusing to build an emailed link from a " +
        "request header, because that header is supplied by the caller."
    );
    this.name = "MissingPublicOrigin";
  }
}

// For any link we are about to put in an email.
//
// Everywhere else, falling back to the request host is harmless and useful —
// it is how this runs on localhost. In an email it is the whole problem: a
// password reset carries a working token to a real inbox, so the host in that
// link decides where the token ends up.
//
// So in production this refuses rather than guesses. The previous behaviour
// failed open: lose the variable and the app quietly returns to trusting the
// request, with nothing broken, nothing logged and no way to notice. That is
// not hypothetical — PUBLIC_ORIGIN was absent from production for weeks and
// its absence looked exactly like its presence.
//
// Deliberately narrow. It stops credential-bearing mail, not the site: taking
// the lessons away from 105 students to prevent a bad link would be the worse
// trade.
export function emailOrigin(h: { get(name: string): string | null }): string {
  const set = configured();
  if (set) return set;
  if (process.env.NODE_ENV === "production") throw new MissingPublicOrigin();
  return fromHeaders(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
}

// For callers that have already done the work before they need a link.
//
// emailOrigin throws, which is right at the start of a request and wrong in
// the middle of one: the onboard route grants the course first, so a throw
// there left a student enrolled, the caller holding a 500, and nobody told.
// Access is the valuable part and it should stand; the email is the part that
// degrades.
//
// Logs the misconfiguration, and the caller reports "not emailed", so it
// surfaces even though the request goes on to answer success.
export async function emailOriginOrReason(
  h: { get(name: string): string | null },
  endpoint: string
): Promise<{ origin: string; reason?: undefined } | { origin?: undefined; reason: string }> {
  try {
    return { origin: emailOrigin(h) };
  } catch (err) {
    if (err instanceof MissingPublicOrigin) {
      console.error(
        `[origin] PUBLIC_ORIGIN is not set: ${endpoint} could not build a sign-in link, so nobody was emailed`
      );
      return { reason: "PUBLIC_ORIGIN is not set, so no sign-in link could be built" };
    }
    throw err;
  }
}

export function publicOrigin(request: Request): string {
  return (
    configured() ??
    fromHeaders(
      request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
      request.headers.get("x-forwarded-proto")
    )
  );
}

// The same decision for server actions, which read headers from context
// rather than from a Request they were handed.
export function originFrom(h: {
  get(name: string): string | null;
}): string {
  return configured() ?? fromHeaders(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
}
