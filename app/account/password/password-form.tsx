"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { clearRecoveryGrant } from "./actions";

const MIN_LENGTH = 8; // matches Supabase's password_min_length

export function PasswordForm({
  email,
  hasPassword,
  fromRecovery,
}: {
  email: string;
  hasPassword: boolean;
  fromRecovery: boolean;
}) {
  // Three states, and only the middle one should ask for the old password:
  //   - no password yet            -> just choose one
  //   - has one, came from a link  -> they forgot it; asking would be absurd
  //   - has one, signed in         -> prove it, so a live session on someone
  //                                   else's machine can't take the account
  const requireCurrent = hasPassword && !fromRecovery;
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }

    setBusy(true);
    const supabase = supabaseBrowser();

    // Supabase lets a signed-in session change the password without proving
    // the old one. For someone who already has a password that's too loose —
    // a borrowed laptop with a live session shouldn't be enough — so check it
    // by signing in with it first.
    if (requireCurrent) {
      const { error: checkError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (checkError) {
        setBusy(false);
        setError("Your current password isn't right.");
        return;
      }
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password,
      data: { has_password: true },
    });
    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    // One reset link, one password change.
    if (fromRecovery) await clearRecoveryGrant();
    setDone(true);
  }

  if (done) {
    return (
      <div className="auth-shell">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/shp-logo.svg" alt="Superhairpieces" className="auth-logo" />
        <p className="auth-academy">Evolve Academy</p>
        <div className="auth-card">
          <h1>Password saved</h1>
          <p className="sub">
            You can now sign in with <strong>{email}</strong> and your password, on any
            device. One-time email links still work if you ever prefer them.
          </p>
          <button
            className="btn"
            style={{ width: "100%" }}
            onClick={() => {
              router.push("/dashboard");
              router.refresh();
            }}
          >
            Go to my courses
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/shp-logo.svg" alt="Superhairpieces" className="auth-logo" />
      <p className="auth-academy">Evolve Academy</p>

      <div className="auth-card">
        <h1>{requireCurrent ? "Change your password" : "Set a new password"}</h1>
        <p className="sub">
          {requireCurrent
            ? `For ${email}.`
            : fromRecovery
              ? `Choose a new password for ${email}. You're signed in from the link we emailed you.`
              : `Choose a password for ${email} so you can sign in without waiting for an email.`}
        </p>

        <form onSubmit={submit}>
          {requireCurrent && (
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="current" className="field-label">Current password</label>
              <input
                id="current"
                className="field-input"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
          )}

          <label htmlFor="password" className="field-label">
            {requireCurrent || fromRecovery ? "New password" : "Password"}
          </label>
          <input
            id="password"
            className="field-input"
            type="password"
            autoComplete="new-password"
            required
            autoFocus={!requireCurrent}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="admin-hint">At least {MIN_LENGTH} characters.</p>

          <div style={{ marginTop: 16 }}>
            <label htmlFor="confirm" className="field-label">Confirm password</label>
            <input
              id="confirm"
              className="field-input"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="btn"
            disabled={busy}
            style={{ width: "100%", marginTop: 18, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "Saving…" : requireCurrent ? "Change password" : "Save password"}
          </button>
          {error && <p className="auth-error">{error}</p>}
        </form>

        <div style={{ marginTop: 18, textAlign: "center" }}>
          <Link href="/dashboard" className="link" style={{ fontSize: 13 }}>
            Skip for now
          </Link>
        </div>
      </div>
    </div>
  );
}
