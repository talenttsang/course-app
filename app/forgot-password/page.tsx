"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { requestPasswordReset } from "../auth/actions";

export default function ForgotPassword() {
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const result = await requestPasswordReset(email);
      if (result.ok) setSent(true);
      else setError(result.error);
    });
  }

  return (
    <div className="auth-shell">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/shp-logo.svg" alt="Superhairpieces" className="auth-logo" />
      <p className="auth-academy">Evolve Academy</p>

      <div className="auth-card">
        {sent ? (
          <>
            <h1>Check your inbox</h1>
            <p className="sub">
              If <strong>{email}</strong> has an account, a link to choose a new password
              is on its way. It can only be used once and expires in 24 hours.
            </p>
            <Link href="/login" className="btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h1>Reset your password</h1>
            <p className="sub">
              Enter the email you use for the academy and we&apos;ll send you a link to
              set a new password.
            </p>
            <form onSubmit={submit}>
              <label htmlFor="email" className="field-label">Email address</label>
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
              <button
                type="submit"
                className="btn"
                disabled={pending}
                style={{ width: "100%", marginTop: 18, opacity: pending ? 0.7 : 1 }}
              >
                {pending ? "Sending…" : "Send reset link"}
              </button>
              {error && <p className="auth-error">{error}</p>}
            </form>
            <div style={{ marginTop: 18, textAlign: "center" }}>
              <Link href="/login" className="link" style={{ fontSize: 13 }}>
                ← Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>

      <p className="auth-foot">
        Trouble signing in?{" "}
        <a href="mailto:support@superhairpieces.com">support@superhairpieces.com</a>
      </p>
    </div>
  );
}
