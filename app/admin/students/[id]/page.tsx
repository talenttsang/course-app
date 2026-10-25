import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "../../../staff-gate";
import { getStudent } from "@/lib/students";
import { supabaseAdmin } from "@/lib/supabase-server";
import { TopNav } from "../../../components";
import { StudentDetail } from "./student-detail";

export const dynamic = "force-dynamic";

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireStaff(`/admin/students/${id}`);
  if (gate.denied) return gate.denied;
  const session = gate.session;

  const student = await getStudent(id);
  if (!student) notFound();

  const { data: courses } = await supabaseAdmin()
    .from("courses")
    .select("id, title")
    .order("bigcommerce_product_id", { ascending: true });

  return (
    <div>
      <TopNav label="COURSE ADMIN" email={session.user.email ?? undefined} />
      <div className="page-wrap" style={{ maxWidth: 820 }}>
        <Link href="/admin/students" className="link" style={{ fontSize: 13 }}>
          ← All students
        </Link>
        <StudentDetail
          student={student}
          courses={courses ?? []}
          isSelf={student.id === session.user.id}
        />
      </div>
    </div>
  );
}
