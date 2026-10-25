"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { safeNextPath } from "@/lib/safe-next";

// Two ways in, because students arrive in two different states. Someone who
// just bought lands here from the welcome email and has no password yet; a
// returning student has one and shouldn't have to wait for an email to read
// a lesson. Password is the default, with the one-time link one click away.
type Mode = "password" | "link";

// Where to go once they are in. Staff arriving from an admin page carry it in
// ?next=, so signing in returns them to the page they actually wanted rather
// than dumping them on the student dashboard. See safeNextPath for what is
// rejected (off-site and protocol-relative targets).
function safeNext(): string {
  if (typeof window === "undefined") return "/dashboard";
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  const [staffBound, setStaffBound] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setStaffBound(safeNext().startsWith("/admin"));
    if (params.get("error") === "link") {
      setError(
        "That sign-in link didn't work — it may have expired or been used already. " +
          "Sign in with your password below, or request a fresh link."
      );
    }
    if (params.get("reset") === "1") {
      setHint("Your password has been changed. Sign in with it below.");
    }
  }, []);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setHint("");
    setBusy(true);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setBusy(false);

    if (!error) {
      router.push(safeNext());
      router.refresh();
      return;
    }

    // Supabase returns the same message whether the password is wrong or the
    // account simply never had one — which is the common case here, since
    // accounts are created by a purchase. Say so rather than leaving people
    // guessing at a password they never chose.
    if (/invalid login credentials/i.test(error.message)) {
      setError(
        "That email and password don't match. If you've never set a password, " +
          "use the one-time link instead and you can set one afterwards."
      );
    } else {
      setError(error.message);
    }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setHint("");
    setBusy(true);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          `${window.location.origin}/auth/callback?next=` +
          encodeURIComponent(safeNext()),
      },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="auth-shell">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/shp-logo.svg" alt="Superhairpieces" className="auth-logo" />
      <p className="auth-academy">
        Evolve Academy{staffBound ? " \u00b7 Course admin" : ""}
      </p>

      <div className="auth-card">
        {sent ? (
          <>
            <h1>Check your inbox</h1>
            <p className="sub" style={{ marginBottom: 0 }}>
              We sent a sign-in link to <strong>{email}</strong>. Open it on this device
              to go straight to your courses. It can take a minute to arrive — check your
              spam folder too.
            </p>
          </>
        ) : (
          <>
            <h1>Sign in to your courses</h1>
            <p className="sub">
              {mode === "password"
                ? "Use the email you purchased with."
                : "We'll email you a one-time link — no password needed."}
            </p>

            <form onSubmit={mode === "password" ? signInWithPassword : sendLink}>
              <label htmlFor="email" className="field-label">
                Email address
              </label>
              <input
                id="email"
                className="field-input"
                type="email"
                autoComplete="email"
                required
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              {mode === "password" && (
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                    }}
                  >
                    <label htmlFor="password" className="field-label">
                      Password
                    </label>
                    <Link
                      href="/forgot-password"
                      className="link"
                      style={{ fontSize: 12.5, fontWeight: 500 }}
                    >
                      Forgot it?
                    </Link>
                  </div>
                  <input
                    id="password"
                    className="field-input"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              )}

              <button
                type="submit"
                className="btn"
                disabled={busy}
                style={{ width: "100%", marginTop: 18, opacity: busy ? 0.7 : 1 }}
              >
                {busy
                  ? mode === "password"
                    ? "Signing in…"
                    : "Sending…"
                  : mode === "password"
                    ? "Sign in"
                    : "Email me a sign-in link"}
              </button>

              {error && <p className="auth-error">{error}</p>}
              {hint && <p className="admin-notice">{hint}</p>}
            </form>

            <div className="auth-divider"><span>or</span></div>

            <button
              type="button"
              className="btn-ghost"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => {
                setMode(mode === "password" ? "link" : "password");
                setError("");
                setHint("");
              }}
            >
              {mode === "password" ? "Email me a one-time link" : "Sign in with a password"}
            </button>
          </>
        )}
      </div>

      <p className="auth-foot">
        Trouble signing in?{" "}
        <a href="mailto:support@superhairpieces.com">support@superhairpieces.com</a>
        <br />© {new Date().getFullYear()} Superhairpieces
      </p>
    </div>
  );
}
