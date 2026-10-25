"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  grantCourse,
  revokeCourse,
  deleteStudent,
  resendWelcome,
  changeStudentEmail,
} from "../actions";
import type { Student } from "@/lib/students";

export function StudentDetail({
  student,
  courses,
  isSelf,
}: {
  student: Student;
  courses: { id: string; title: string }[];
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const owned = new Set(student.courses.map((c) => c.id));
  const hasAnyCourse = student.courses.length > 0;
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState(student.email);

  function toggle(courseId: string, title: string, has: boolean) {
    if (has && !confirm(`Remove access to “${title}” for ${student.email}?`)) return;
    setError("");
    setNotice("");
    start(async () => {
      const result = has
        ? await revokeCourse({ userId: student.id, courseId })
        : await grantCourse({ userId: student.id, courseId });
      if (result.ok) {
        setNotice(has ? `Access to “${title}” removed.` : `Access to “${title}” granted.`);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    start(async () => {
      const result = await changeStudentEmail({ userId: student.id, email: newEmail });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingEmail(false);
      setNotice(
        `Email changed to ${result.email}. Their course access is unchanged. ` +
          `Nothing has been sent yet — use “Resend sign-in link” to write to the new address.`
      );
      router.refresh();
    });
  }

  function resend() {
    setError("");
    setNotice("");
    start(async () => {
      const result = await resendWelcome(student.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Say plainly whether mail actually left. "Sent" when it did not is
      // how a student ends up waiting on an email nobody is going to chase.
      setNotice(
        result.emailed
          ? `A fresh sign-in link has been emailed to ${student.email}. It is good for ${result.linkHours ?? 24} hours.`
          : `Nothing was sent — ${result.emailError ?? "the mail server rejected it"}. Contact ${student.email} another way.`
      );
      router.refresh();
    });
  }

  function remove() {
    if (
      !confirm(
        `Delete the account for ${student.email}? This removes their access and progress, and can't be undone.`
      )
    )
      return;
    setError("");
    start(async () => {
      const result = await deleteStudent(student.id);
      if (result.ok) router.push("/admin/students");
      else setError(result.error);
    });
  }

  return (
    <div>
      <p className="page-eyebrow" style={{ marginTop: 18 }}>Student</p>
      {editingEmail ? (
        <form onSubmit={saveEmail} style={{ margin: "6px 0 24px", maxWidth: 460 }}>
          <label className="field-label" htmlFor="student-email">
            Email address
          </label>
          <input
            id="student-email"
            className="field-input"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            autoFocus
            required
          />
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "8px 0 12px", lineHeight: 1.6 }}>
            Their courses and progress stay with them — access is tied to the
            account, not the address. They will need a fresh sign-in link
            afterwards.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn admin-sm" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save email"}
            </button>
            <button
              className="btn-ghost admin-sm"
              type="button"
              onClick={() => {
                setEditingEmail(false);
                setNewEmail(student.email);
                setError("");
              }}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 className="page-title" style={{ fontSize: 26, wordBreak: "break-all", margin: 0 }}>
            {student.email}
          </h1>
          <button
            className="btn-ghost admin-sm"
            onClick={() => setEditingEmail(true)}
            disabled={pending}
            title="Correct a mistyped address"
          >
            Change email
          </button>
        </div>
      )}
      <div style={{ height: 18 }} />

      {error && <p className="auth-error">{error}</p>}
      {notice && <p className="admin-notice">{notice}</p>}

      <table className="admin-table" style={{ marginBottom: 40 }}>
        <tbody>
          <tr>
            <td style={{ width: 200, color: "var(--muted)" }}>Joined</td>
            <td>{formatDateTime(student.createdAt)}</td>
          </tr>
          <tr>
            <td style={{ color: "var(--muted)" }}>Last signed in</td>
            <td>{student.lastSignInAt ? formatDateTime(student.lastSignInAt) : "Never signed in"}</td>
          </tr>
          <tr>
            <td style={{ color: "var(--muted)" }}>Sign-in method</td>
            <td>
              {student.hasPassword
                ? "Password, or a one-time email link"
                : "One-time email link only — no password set"}
            </td>
          </tr>
          <tr>
            <td style={{ color: "var(--muted)" }}>Welcome email</td>
            <td>
              {student.welcomeError ? (
                <span className="admin-warn" style={{ marginLeft: 0 }}>Failed — {student.welcomeError}</span>
              ) : student.welcomeSentAt ? (
                `Sent ${formatDateTime(student.welcomeSentAt)}`
              ) : (
                <span className="admin-warn" style={{ marginLeft: 0 }}>Never sent</span>
              )}
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn-ghost admin-sm"
                  onClick={resend}
                  disabled={pending || !hasAnyCourse}
                  title={
                    hasAnyCourse
                      ? "Email them the welcome again, with a new sign-in link"
                      : "Give them a course first — there is nothing to welcome them to"
                  }
                >
                  Resend sign-in link
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="admin-section-head">
        <h2>Course access</h2>
      </div>

      <table className="admin-table" style={{ marginBottom: 40 }}>
        <thead>
          <tr>
            <th>Course</th>
            <th>How they got it</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {courses.map((c) => {
            const has = owned.has(c.id);
            const record = student.courses.find((x) => x.id === c.id);
            return (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td style={{ fontSize: 13, color: "var(--muted)" }}>
                  {!has
                    ? "—"
                    : record?.orderId
                      ? `Order ${record.orderId}`
                      : "Granted by staff"}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className={has ? "btn-ghost admin-sm admin-danger" : "btn admin-sm"}
                    onClick={() => toggle(c.id, c.title, has)}
                    disabled={pending}
                  >
                    {has ? "Remove access" : "Give access"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="admin-section-head">
        <h2>Delete account</h2>
      </div>
      <div className="admin-card">
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 16px", lineHeight: 1.6 }}>
          Removes the account, its course access and its progress. Their BigCommerce
          order is untouched — if that order is still marked paid, a future webhook
          from BigCommerce would recreate the account and re-grant access.
        </p>
        <button
          className="btn-ghost admin-danger"
          onClick={remove}
          disabled={pending || isSelf}
          title={isSelf ? "This is your own account" : "Delete this account"}
        >
          Delete this account
        </button>
        {isSelf && (
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "12px 0 0" }}>
            This is your own account, so it can&apos;t be deleted here.
          </p>
        )}
      </div>
    </div>
  );
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
