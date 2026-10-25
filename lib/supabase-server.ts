import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

// Regular client, respects the logged-in user's session (RLS active).
//
// Async because cookies() is: Next made the request-scoped accessors async
// in 15, so anything that reads them has to be awaited, and so does this.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );
}

// Like supabaseServer(), but able to WRITE the session cookies. Used by
// the auth routes that turn a sign-in link into a logged-in session.
export async function supabaseRouteClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: Record<string, unknown>) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );
}

// Cloud Run terminates TLS upstream, so request.url carries the container
// address (0.0.0.0:8080). Redirects have to be built from the forwarded host.
export { publicOrigin } from "./origin";

// Admin client, bypasses RLS. Server-side only (admin actions and API
// routes); never reaches the browser.
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
