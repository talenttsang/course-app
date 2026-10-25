"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addAdmin, removeAdmin, inviteStaff } from "./actions";

type Staff = { email: string; addedBy: string | null; permanent: boolean };

export function StaffManager({ staff, currentEmail }: { staff: Staff[]; currentEmail: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    start(async () => {
      const target = email.trim().toLowerCase();
      const result = await addAdmin(target);
      if (result.ok) {
        // They have access either way; whether they were told is the part
        // somebody has to act on, so never report it as sent when it wasn't.
        setNotice(
          result.emailed
            ? `${target} can now manage courses, is enrolled in all of them, and has been emailed a sign-in link good for ${result.linkHours ?? 24} hours.`
            : `${target} can now manage courses, but the email did not send — ${result.emailError ?? "unknown reason"}. Tell them another way, or use Resend invite.`
        );
        setEmail("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function invite(target: string) {
    setError("");
    setNotice("");
    start(async () => {
      const result = await inviteStaff(target);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        result.emailed
          ? `A fresh sign-in link has been emailed to ${target}. It is good for ${result.linkHours ?? 24} hours.`
          : `Nothing was sent — ${result.emailError ?? "the mail server rejected it"}. Contact ${target} another way.`
      );
      router.refresh();
    });
  }

  function remove(target: string) {
    if (!confirm(`Remove course access for ${target}?`)) return;
    setError("");
    setNotice("");
    start(async () => {
      const result = await removeAdmin(target);
      if (result.ok) {
        setNotice(`${target} no longer has access.`);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section style={{ marginTop: 48 }}>
      <div className="admin-section-head">
        <h2>Staff access</h2>
        <span>{staff.length} with access</span>
      </div>
      <p style={{ fontSize: 14, color: "var(--muted)", margin: "-8px 0 18px", lineHeight: 1.6 }}>
        Anyone listed here can add, edit and delete courses and lessons on the live
        site, and look after students. They are enrolled in every course too, so
        they can see what a student sees. Adding someone emails them a sign-in
        link straight away — no password, and no separate account to create.
      </p>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Added by</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.email}>
              <td>
                {s.email}
                {s.email === currentEmail && <span className="admin-chip">you</span>}
                {s.permanent && (
                  <span
                    className="admin-chip"
                    title="Set in the server configuration so access can never be lost entirely"
                  >
                    permanent
                  </span>
                )}
              </td>
              <td style={{ color: "var(--muted)", fontSize: 13 }}>
                {s.permanent ? "Server configuration" : s.addedBy ?? "—"}
              </td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {/* A sign-in link lasts 24 hours, so the colleague who reads
                    their email the next morning needs a second one. */}
                <button
                  className="btn-ghost admin-sm"
                  onClick={() => invite(s.email)}
                  disabled={pending}
                  style={{ marginRight: 8 }}
                  title="Email them a sign-in link"
                >
                  Resend invite
                </button>
                {s.permanent || s.email === currentEmail ? (
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    {s.permanent ? "Can't be removed here" : "Can't remove yourself"}
                  </span>
                ) : (
                  <button
                    className="btn-ghost admin-sm admin-danger"
                    onClick={() => remove(s.email)}
                    disabled={pending}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="admin-card" onSubmit={add}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", margin: "0 0 14px" }}>
          Give someone access
        </h3>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <label className="field-label" htmlFor="staff-email">
              Work email address
            </label>
            <input
              id="staff-email"
              className="field-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@superhairpieces.com"
              required
            />
          </div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
        {error && <p className="auth-error">{error}</p>}
        {notice && <p className="admin-notice">{notice}</p>}
      </form>
    </section>
  );
}
