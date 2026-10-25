import { supabaseAdmin } from "@/lib/supabase-server";
import { sendWelcomeEmail } from "@/lib/email";
import { DEFAULT_LOCALE, type Locale, type WelcomeKind } from "@/lib/i18n";

// Must stay in step with Supabase's mailer_otp_exp setting (seconds).
export const SIGN_IN_LINK_HOURS = 24;

// A one-click sign-in link the buyer can open on any device. Built from a
// token_hash (not a PKCE code), so unlike a link requested from the login
// page it isn't tied to one browser — people read purchase emails on their
// phone and click through on a laptop.
export async function createSignInLink(email: string, origin: string) {
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    throw new Error(`could not generate sign-in link: ${error?.message ?? "no token"}`);
  }
  const params = new URLSearchParams({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
    next: "/dashboard",
  });
  return `${origin}/auth/confirm?${params.toString()}`;
}

// Access on its own isn't onboarding: a student who is never told they have
// a course, and never given a way in, is no better off than before they
// paid. Every onboarding path ends here so that they all produce an
// identical experience for the buyer.
//
// Never throws. By the time this runs the course is already granted, and a
// mail server hiccup must not undo that or fail the caller — an admin
// would be left staring at an error for something that actually worked.
export async function sendCourseWelcome(opts: {
  to: string;
  courseTitles: string[];
  origin: string;
  locale?: Locale;
  kind?: WelcomeKind;
  // When given, the outcome is recorded on the account, so staff can see
  // whether a student was ever actually told they have a course.
  userId?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const signInUrl = await createSignInLink(opts.to, opts.origin);
    const result = await sendWelcomeEmail({
      to: opts.to,
      courseTitles: opts.courseTitles,
      signInUrl,
      origin: opts.origin,
      linkHours: SIGN_IN_LINK_HOURS,
      locale: opts.locale ?? DEFAULT_LOCALE,
      kind: opts.kind,
    });
    await recordWelcomeOutcome(opts.userId, result.sent, result.reason);
    return result.sent ? { sent: true } : { sent: false, reason: result.reason };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[onboarding] welcome email failed:", reason);
    await recordWelcomeOutcome(opts.userId, false, reason);
    return { sent: false, reason };
  }
}

// Remembers whether the student was told. Without this, "has access" and
// "knows they have access" are indistinguishable in the admin portal, and
// the second is the one that gets a customer waiting.
//
// Never throws: this is bookkeeping about an email, and failing to write it
// must not undo a grant that already succeeded.
async function recordWelcomeOutcome(
  userId: string | undefined,
  sent: boolean,
  reason?: string
) {
  if (!userId) return;
  try {
    const admin = supabaseAdmin();
    const { data } = await admin.auth.admin.getUserById(userId);
    if (!data.user) return;
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...(data.user.user_metadata ?? {}),
        ...(sent
          ? { welcome_sent_at: new Date().toISOString(), welcome_error: null }
          : { welcome_error: reason ?? "unknown" }),
      },
    });
  } catch (err) {
    console.error("[onboarding] could not record welcome outcome:", err);
  }
}
