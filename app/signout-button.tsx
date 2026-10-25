"use client";
import { supabaseBrowser } from "@/lib/supabase-browser";

// Two looks for one behaviour: "page" sits on the light body, "nav" on the
// dark bar, where a light-bodied button would be invisible.
export function SignOutButton({ tone = "page" }: { tone?: "page" | "nav" }) {
  async function handleSignOut() {
    await supabaseBrowser().auth.signOut();
    // A hard navigation rather than a router push: the server components
    // above this have already rendered with a session, and only a fresh
    // request re-runs the gates that decide what this person may see.
    window.location.href = "/login";
  }

  if (tone === "nav") {
    return (
      <button
        onClick={handleSignOut}
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 1.5,
          color: "rgba(255,255,255,0.75)",
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 999,
          padding: "5px 14px",
          whiteSpace: "nowrap",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        SIGN OUT
      </button>
    );
  }

  return (
    <button className="btn-ghost" onClick={handleSignOut} style={{ padding: "9px 18px", fontSize: 13 }}>
      Sign out
    </button>
  );
}
