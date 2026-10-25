import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireStaff } from "../../../staff-gate";
import { TopNav } from "../../../components";
import { CourseEditor } from "./course-editor";

export const dynamic = "force-dynamic";

export default async function AdminCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireStaff(`/admin/course/${id}`);
  if (gate.denied) return gate.denied;
  const session = gate.session;

  const db = supabaseAdmin();
  const { data: course } = await db
    .from("courses")
    .select("id, slug, title, description, bigcommerce_product_id")
    .eq("id", id)
    .maybeSingle();

  if (!course) notFound();

  const { data: lessons } = await db
    .from("course_videos")
    .select("id, title, module_title, source_id, source_type, position")
    .eq("course_id", course.id)
    .order("position", { ascending: true });

  const { count: buyers } = await db
    .from("purchases")
    .select("id", { count: "exact", head: true })
    .eq("course_id", course.id);

  return (
    <div>
      <TopNav label="COURSE ADMIN" email={session.user.email ?? undefined} />
      <div className="page-wrap">
        <Link href="/admin" className="link" style={{ fontSize: 13 }}>
          ← All courses
        </Link>
        <CourseEditor
          course={course}
          lessons={lessons ?? []}
          buyers={buyers ?? 0}
        />
      </div>
    </div>
  );
}
