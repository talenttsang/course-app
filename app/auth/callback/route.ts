import { NextResponse } from "next/server";
import { supabaseRouteClient, publicOrigin } from "@/lib/supabase-server";
import { safeNextPath } from "@/lib/safe-next";

// Landing point for a link the LOGIN PAGE requested. That flow is PKCE:
// the browser kept a verifier, so the link only works in that same
// browser. We swap the one-time ?code= for a session cookie here.
// Links we mail out ourselves go to /auth/confirm instead.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // Only same-site absolute paths. See safeNextPath.
  const next = safeNextPath(searchParams.get("next"));
  const origin = publicOrigin(request);

  if (code) {
    const supabase = await supabaseRouteClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link`);
}
