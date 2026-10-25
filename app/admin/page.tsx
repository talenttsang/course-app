import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-server";
import { listStaff } from "@/lib/admin";
import { requireStaff } from "../staff-gate";
import { TopNav } from "../components";
import { NewCourseForm } from "./new-course-form";
import { StaffManager } from "./staff-manager";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const gate = await requireStaff("/admin");
  if (gate.denied) return gate.denied;
  const session = gate.session;
  const staff = await listStaff();

  // Service-role read so counts include every student's purchases, which
  // RLS would otherwise hide.
  const db = supabaseAdmin();
  const { data: courses } = await db
    .from("courses")
    .select("id, slug, title, bigcommerce_product_id, created_at")
    .order("created_at", { ascending: true });

  const { data: lessons } = await db.from("course_videos").select("course_id");
  const { data: purchases } = await db.from("purchases").select("course_id");

  const lessonCount = tally(lessons?.map((l) => l.course_id));
  const buyerCount = tally(purchases?.map((p) => p.course_id));

  return (
    <div>
      <TopNav label="COURSE ADMIN" email={session.user.email ?? undefined} />
      <div className="page-wrap">
        <p className="page-eyebrow">Evolve Academy</p>
        <h1 className="page-title">Courses</h1>
        <p className="page-sub">
          Add a course here and link it to its BigCommerce product. Buyers are onboarded
          from the Waiting page.
        </p>

        <p style={{ margin: "-24px 0 32px" }}>
          <Link href="/admin/waiting" className="btn-ghost admin-sm">
            Waiting buyers →
          </Link>{" "}
          <Link href="/admin/students" className="btn-ghost admin-sm">
            Manage students →
          </Link>
        </p>

        {(courses ?? []).length === 0 ? (
          <div className="empty-state" style={{ marginBottom: 40 }}>
            No courses yet. Add your first one below.
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Course</th>
                <th className="num">Product ID</th>
                <th className="num">Lessons</th>
                <th className="num">Students</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(courses ?? []).map((c) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: "var(--ink)" }}>{c.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--muted)" }}>/course/{c.slug}</div>
                  </td>
                  <td className="num">{c.bigcommerce_product_id}</td>
                  <td className="num">
                    {lessonCount.get(c.id) ?? 0}
                    {(lessonCount.get(c.id) ?? 0) === 0 && (
                      <span className="admin-warn" title="Students will see “Lessons coming soon”">
                        empty
                      </span>
                    )}
                  </td>
                  <td className="num">{buyerCount.get(c.id) ?? 0}</td>
                  <td style={{ textAlign: "right" }}>
                    <Link href={`/admin/course/${c.id}`} className="btn-ghost admin-sm">
                      Manage lessons
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)", margin: "0 0 6px" }}>
          Add a course
        </h2>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 22px" }}>
          Create the product in BigCommerce first, then paste its product ID here.
        </p>
        <NewCourseForm />

        <StaffManager staff={staff} currentEmail={(session.user.email ?? "").toLowerCase()} />
      </div>
    </div>
  );
}

function tally(ids?: string[]) {
  const map = new Map<string, number>();
  for (const id of ids ?? []) map.set(id, (map.get(id) ?? 0) + 1);
  return map;
}

// Deliberately vague: this page shouldn't confirm to a signed-in student
// whether an admin area exists, or who is on the allowlist.
