import Link from "next/link";
import { requireStaff } from "../../staff-gate";
import { listStudents } from "@/lib/students";
import { supabaseAdmin } from "@/lib/supabase-server";
import { TopNav } from "../../components";
import { StudentsTable } from "./students-table";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const gate = await requireStaff("/admin/students");
  if (gate.denied) return gate.denied;
  const session = gate.session;

  const students = await listStudents();
  const { data: courses } = await supabaseAdmin()
    .from("courses")
    .select("id, title")
    .order("bigcommerce_product_id", { ascending: true });

  return (
    <div>
      <TopNav label="COURSE ADMIN" email={session.user.email ?? undefined} />
      <div className="page-wrap">
        <Link href="/admin" className="link" style={{ fontSize: 13 }}>
          ← Courses
        </Link>
        <p className="page-eyebrow" style={{ marginTop: 18 }}>Evolve Academy</p>
        <h1 className="page-title">Students</h1>
        <p className="page-sub">
          Everyone with an account. Access is granted automatically on purchase — use
          this when you need to correct it by hand.
        </p>

        <StudentsTable students={students} courses={courses ?? []} />
      </div>
    </div>
  );
}
