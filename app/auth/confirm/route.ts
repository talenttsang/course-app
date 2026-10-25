import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseRouteClient, publicOrigin } from "@/lib/supabase-server";
import { RECOVERY_COOKIE, RECOVERY_MAX_AGE } from "@/lib/recovery-grant";
import { safeNextPath } from "@/lib/safe-next";

// Landing point for the sign-in link we mail out ourselves (welcome
// email after a purchase). These links carry a token_hash rather than a
// PKCE code, so — unlike /auth/callback — they work in ANY browser or
// device. That matters: people read the purchase email on their phone.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Only same-site absolute paths. See safeNextPath.
  const next = safeNextPath(searchParams.get("next"));
  const origin = publicOrigin(request);

  if (token_hash && type) {
    const supabase = await supabaseRouteClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) {
      // Someone arriving from a reset link has proved they own the mailbox,
      // but by definition can't supply their current password. Record that
      // server-side rather than in the URL, so a signed-in session can't
      // claim it by adding a query parameter.
      if (type === "recovery") {
        (await cookies()).set({
          name: RECOVERY_COOKIE,
          value: "1",
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: RECOVERY_MAX_AGE,
        });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link`);
}
