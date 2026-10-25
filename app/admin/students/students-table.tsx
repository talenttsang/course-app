"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createStudent } from "./actions";
import type { Student } from "@/lib/students";

export function StudentsTable({
  students,
  courses,
}: {
  students: Student[];
  courses: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? students.filter(
          (s) =>
            s.email.toLowerCase().includes(q) ||
            (s.name ?? "").toLowerCase().includes(q)
        )
      : students;
  }, [students, query]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    start(async () => {
      const target = email.trim().toLowerCase();
      const result = await createStudent({ email, courseId, notify, name });
      if (result.ok) {
        // Say plainly whether the buyer was actually told. "Access granted"
        // on its own would leave staff assuming an email went out when the
        // mail server was down, and nobody would follow up.
        setNotice(
          result.emailed
            ? `${target} now has access, and a welcome email with a sign-in link is on its way.`
            : notify
              ? `${target} now has access, but the welcome email could not be sent${
                  result.emailError ? ` (${result.emailError})` : ""
                }. Send them the sign-in page yourself.`
              : `${target} now has access. No email was sent.`
        );
        setEmail("");
        setName("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <div className="admin-section-head">
        <h2>All students</h2>
        <span>
          {shown.length === students.length
            ? `${students.length} total`
            : `${shown.length} of ${students.length}`}
        </span>
      </div>

      <div style={{ maxWidth: 340, marginBottom: 16 }}>
        <input
          className="field-input"
          type="search"
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <div className="empty-state" style={{ padding: "32px 24px", marginBottom: 44 }}>
          {students.length === 0
            ? "No students yet. They appear here automatically when someone buys a course."
            : "No student matches that search."}
        </div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Courses</th>
              <th>Welcome email</th>
              <th className="num">Sign-in</th>
              <th className="num">Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td style={{ fontWeight: 500 }}>
                  {s.name ?? <span style={{ color: "var(--muted)" }}>—</span>}
                </td>
                <td>
                  {s.email}
                  {s.hasPassword && <span className="admin-chip">password</span>}
                </td>
                <td style={{ fontSize: 13, color: "var(--muted)" }}>
                  {s.courses.length === 0 ? (
                    <span className="admin-warn">no access</span>
                  ) : (
                    s.courses.map((c) => c.title.replace(/^Men's Hair Replacement Specialist Program: /, "")).join(", ")
                  )}
                </td>
                <td style={{ fontSize: 13 }}>
                  {s.welcomeSentAt ? (
                    <span style={{ color: "var(--muted)" }}>
                      sent {formatDate(s.welcomeSentAt)}
                    </span>
                  ) : s.courses.length === 0 ? (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  ) : (
                    // Has a course but was never told about it. This is the
                    // state that leaves a paying customer waiting, so it is
                    // called out rather than left blank.
                    <span className="admin-warn">not sent</span>
                  )}
                </td>
                <td className="num" style={{ fontSize: 13, color: "var(--muted)" }}>
                  {s.lastSignInAt ? formatDate(s.lastSignInAt) : "never"}
                </td>
                <td className="num" style={{ fontSize: 13, color: "var(--muted)" }}>
                  {formatDate(s.createdAt)}
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link href={`/admin/students/${s.id}`} className="btn-ghost admin-sm">
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)", margin: "0 0 6px" }}>
        Give someone access by hand
      </h2>
      <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 20px", lineHeight: 1.6 }}>
        For a sale taken outside the store, a comped place, or a buyer who used a
        different email at checkout. If they already have an account, this just adds
        the course to it.
      </p>

      <form className="admin-card" onSubmit={add}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ minWidth: 190 }}>
            <label className="field-label" htmlFor="student-name">Name</label>
            <input
              id="student-name"
              className="field-input"
              type="text"
              placeholder="Optional"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="field-label" htmlFor="student-email">Email address</label>
            <input
              id="student-email"
              className="field-input"
              type="email"
              required
              placeholder="student@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div style={{ minWidth: 240 }}>
            <label className="field-label" htmlFor="student-course">Course</label>
            <select
              id="student-course"
              className="field-input"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit" disabled={pending || !courseId}>
            {pending ? "Adding…" : "Give access"}
          </button>
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 14,
            fontSize: 13.5,
            color: "var(--muted)",
          }}
        >
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          Email them a welcome with a one-click sign-in link
        </label>
        {error && <p className="auth-error">{error}</p>}
        {notice && <p className="admin-notice">{notice}</p>}
      </form>
    </>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
