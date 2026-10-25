"use server";

import { headers } from "next/headers";
import { emailOrigin, MissingPublicOrigin } from "@/lib/origin";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sendPasswordResetEmail, smtpConfigured } from "@/lib/email";
import { describeError, describeErrorForLog } from "@/lib/redact";
import { localeForCourses, DEFAULT_LOCALE } from "@/lib/i18n";

// Must stay in step with Supabase's mailer_otp_exp setting (seconds).
const RESET_LINK_HOURS = 24;

// Deliberately the shared helper, which prefers PUBLIC_ORIGIN over anything
// the request claims. A reset mail carries a working token to a real
// customer's inbox; if the host in that link came from a header a caller
// controls, the link points wherever the caller likes and the token goes
// with it. The other three places that build an origin were centralised
// last week and this one was missed — it is the one that mattered most.
async function originFromHeaders() {
  return emailOrigin(await headers());
}

// Sends a reset link through our own SMTP rather than Supabase's mailer,
// which is capped at 2 emails/hour on the free plan — a cap that would bite
// exactly when several students are locked out at once.
//
// Always reports success, even for an address with no account. Saying
// "no such user" would turn this form into a way to test which of your
// customers' emails are registered.
// The visitor is told the same thing whether or not the address is one of
// ours — this form must not double as a way to check who has an account.
// It is NOT told that when the failure is ours: a student locked out during
// an SMTP outage would otherwise sit waiting for mail that is never coming.
const UNDELIVERABLE =
  "We could not send that email just now. This is a problem on our side, not with your account — please try again in a few minutes.";

// One log line per failure *kind* per window. The form can be resubmitted as
// fast as anyone can click, and during an outage that would bury the logs in
// one line per attempt. Best effort only: this counts per container, so
// several instances can still log one each.
const ALERT_WINDOW_MS = 15 * 60 * 1000;
const lastAlertAt = new Map<string, number>();

// `what` names the thing for whoever reads the alert; `kind` separates one
// failure from another behind it. They used to be the same string, so one
// mailbox bouncing a 550 held the key "SMTP" for fifteen minutes — and an
// outage starting inside that window was never announced. A refused
// recipient and a dead mailer are not the same news and must not share a
// throttle.
async function alertOnce(what: string, kind: string, detail: string, note?: string) {
  const key = `${what}:${kind}`;
  const now = Date.now();
  if (now - (lastAlertAt.get(key) ?? 0) < ALERT_WINDOW_MS) return;
  lastAlertAt.set(key, now);
  console.error(`[auth] ${what}: ${detail}. ${note ?? "Nothing was sent until the setting is restored."}`);
}

// The closing line for a failure that is not a missing setting. The default
// one tells the reader to restore a setting, which sends them looking for a
// variable that is fine when the real answer is a refused recipient or a
// mailer that is down.
const NOT_A_SETTING =
  "Nothing was sent. Further alerts of this kind are held for 15 minutes.";

// nodemailer labels what went wrong: EENVELOPE is the server refusing this
// one recipient, ESOCKET and ECONNECTION the mailer being unreachable, EAUTH
// the credentials. Throttling on the label keeps them apart.
function failureKind(err: unknown) {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && code ? code : "unknown";
}

// Everything that must never reach a log line.
//
// The service role key is in here because the auth client can quote it back
// in an error ("Invalid API key: ..."), and the redaction's fallback for a
// credential it was not told about is a guess. A secret we name is removed
// with certainty; one we leave out rests on that guess.
function mailSecrets() {
  return [
    process.env.SMTP_USER,
    process.env.SMTP_PASS,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ];
}

// Supabase's PostgREST errors are plain objects, not Errors, so describeError
// would decline to read them. Give it the shape it expects.
function asError(e: { message?: string; code?: string }) {
  return Object.assign(new Error(e.message ?? "unknown"), { code: e.code });
}

// "No such account" is the one answer the visitor is allowed to be unable to
// distinguish. Everything else from the auth service is our failure, and
// saying so reveals nothing: a service that is down is down for every
// address alike.
function isNoSuchUser(error: { status?: number; code?: string; message?: string }) {
  return (
    error.code === "user_not_found" ||
    error.status === 404 ||
    /user not found/i.test(error.message ?? "")
  );
}

export async function requestPasswordReset(emailInput: string) {
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, error: "That doesn't look like an email address." };
  }

  // Asked before the address is looked up, so an unconfigured mailer answers
  // every address identically and tells nobody who is registered.
  if (!smtpConfigured()) {
    console.error("[password-reset] SMTP is not configured; no reset mail can go out");
    await alertOnce(
      "SMTP",
      "unconfigured",
      "password reset requests are being refused because no mailer is configured",
      "Nothing was sent, and nothing will be until SMTP_HOST and SMTP_PASS are set on the service."
    );
    return { ok: false as const, error: UNDELIVERABLE };
  }

  try {
    const origin = await originFromHeaders();
    const { data, error } = await supabaseAdmin().auth.admin.generateLink({
      type: "recovery",
      email,
    });

    if (error) {
      if (isNoSuchUser(error)) {
        return { ok: true as const };
      }
      // A bad service key or an auth outage used to land here and report
      // success, so nobody was told and the visitor waited for nothing.
      // Logged through describeError like every other failure here: the
      // server log is not a private place either, and an auth error repeats
      // whatever it was handed, the address included.
      console.error(
        "[password-reset] auth service refused to make a link:",
        describeErrorForLog(error, mailSecrets())
      );
      await alertOnce(
        "Supabase auth",
        String(error.code ?? error.status ?? "unknown"),
        `password reset links cannot be created (${error.code ?? error.status ?? "unknown"}), so no reset email is going out`,
        NOT_A_SETTING
      );
      return { ok: false as const, error: UNDELIVERABLE };
    }

    if (!data?.properties?.hashed_token) {
      console.error("[password-reset] auth service returned no token and no error");
      await alertOnce(
        "Supabase auth",
        "empty",
        "password reset links came back empty with no error reported",
        NOT_A_SETTING
      );
      return { ok: false as const, error: UNDELIVERABLE };
    }

    const params = new URLSearchParams({
      token_hash: data.properties.hashed_token,
      type: "recovery",
      next: "/account/password",
    });
    // Looked up before the try, not inside it: a failure here is a database
    // problem, and reporting it as a mail failure would send us looking in
    // the wrong place.
    const locale = await localeForStudent(data.user?.id);

    let result: Awaited<ReturnType<typeof sendPasswordResetEmail>>;
    try {
      result = await sendPasswordResetEmail({
        to: email,
        resetUrl: `${origin}/auth/confirm?${params.toString()}`,
        origin,
        linkHours: RESET_LINK_HOURS,
        locale,
      });
    } catch (sendErr) {
      // Caught here rather than below so the alert can say which step failed.
      // Reaching this point means the link was made, so the account exists
      // and the mail is the only thing that went wrong.
      const described = describeError(sendErr, mailSecrets());
      console.error("[password-reset] SMTP send failed:", describeErrorForLog(sendErr, mailSecrets()));
      await alertOnce(
        "SMTP",
        failureKind(sendErr),
        `a password reset email could not be sent (${described})`,
        NOT_A_SETTING
      );
      return { ok: false as const, error: UNDELIVERABLE };
    }

    // send() reports a refusal rather than throwing, so this is reached
    // without the catch below ever running.
    if (!result?.sent) {
      console.error("[password-reset] send refused:", result?.reason ?? "unknown");
      await alertOnce(
        "SMTP",
        result?.reason ?? "unknown",
        `a password reset email was not sent (${result?.reason ?? "unknown"})`,
        NOT_A_SETTING
      );
      return { ok: false as const, error: UNDELIVERABLE };
    }
  } catch (err) {
    console.error("[password-reset] failed for a request:", describeErrorForLog(err, mailSecrets()));

    // A missing PUBLIC_ORIGIN is not a transient hiccup: every reset from now
    // on fails the same way, so it is worth naming on its own.
    if (err instanceof MissingPublicOrigin) {
      await alertOnce(
        "PUBLIC_ORIGIN",
        "missing",
        "password reset links cannot be built, so no reset email is going out"
      );
    } else {
      // Anything else that throws -- SMTP refusing the connection, the auth
      // service unreachable -- was previously logged and nothing more.
      await alertOnce(
        "password reset",
        failureKind(err),
        `a password reset failed unexpectedly (${describeError(err, mailSecrets())})`,
        NOT_A_SETTING
      );
    }

    return { ok: false as const, error: UNDELIVERABLE };
  }

  return { ok: true as const };
}

// A reset mail should arrive in the language the student's course is taught
// in — being locked out is exactly the wrong moment to hand someone
// instructions they can't read.
async function localeForStudent(userId?: string) {
  if (!userId) return DEFAULT_LOCALE;
  const { data, error } = await supabaseAdmin()
    .from("purchases")
    .select("courses(bigcommerce_product_id)")
    .eq("user_id", userId);
  if (error) {
    // Swallowing this sent a Spanish student an English reset mail and told
    // nobody. The mail still goes out — locked out in the wrong language
    // beats not being let back in at all — but a failed lookup is a database
    // problem and is now reported as one rather than read as a default.
    console.error("[password-reset] could not read the student's courses:", describeErrorForLog(asError(error)));
    await alertOnce(
      "course lookup",
      error.code || "unknown",
      "reset emails are going out in the default language because a student's courses could not be read",
      "This does not stop the email; if the send is failing too, that is reported separately. Further alerts of this kind are held for 15 minutes."
    );
    return DEFAULT_LOCALE;
  }
  // PostgREST types an embedded row as an array, so flatten before reading.
  // Wrapped because a row of an unexpected shape used to throw out of here
  // and be reported as "a password reset failed unexpectedly" -- which sends
  // whoever reads it to the reset, when the fault is in this lookup.
  try {
    const ids = (data ?? [])
      .flatMap((row) => (Array.isArray(row.courses) ? row.courses : [row.courses]))
      .map((c) => (c as { bigcommerce_product_id?: number } | null)?.bigcommerce_product_id)
      .filter((id): id is number => typeof id === "number");
    return ids.length ? localeForCourses(ids) : DEFAULT_LOCALE;
  } catch (shapeErr) {
    console.error("[password-reset] a purchases row was not the shape expected:", describeErrorForLog(shapeErr));
    await alertOnce(
      "course lookup",
      "shape",
      "a student's courses could not be read because a purchases row was not the shape expected",
      "This does not stop the email; it goes out in the default language. If the send is failing too, that is reported separately."
    );
    return DEFAULT_LOCALE;
  }
}
