import { redirect, notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { TopNav } from "../../components";
import { CourseViewer } from "./course-viewer";

// Access control happens HERE, on the server. If the student hasn't
// purchased the course, the video IDs never reach the browser at all.
//
// The database enforces the same rule independently: course_videos is
// readable only by someone who owns the course. This comment used to claim
// the guarantee while the table was world-readable through the public anon
// key, which is the kind of gap a comment alone will never close.
export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description")
    .eq("slug", slug)
    .single();

  if (!course) notFound();

  const { data: purchase } = await supabase
    .from("purchases")
    .select("id")
    .eq("user_id", user.id)
    .eq("course_id", course.id)
    .maybeSingle();

  if (!purchase) {
    return (
      <div>
        <TopNav label="COURSE" email={user.email ?? undefined} />
        <div className="page-wrap" style={{ maxWidth: 640 }}>
          <div className="empty-state">
            <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--ink)" }}>
              This course isn&apos;t on your account
            </p>
            If you purchased it, make sure you signed in with the same email you used at
            checkout. Think this is a mistake? Contact{" "}
            <a href="mailto:support@superhairpieces.com" className="link">
              support@superhairpieces.com
            </a>
            .
          </div>
        </div>
      </div>
    );
  }

  const { data: videos } = await supabase
    .from("course_videos")
    .select("id, title, source_id, source_type, module_title")
    .eq("course_id", course.id)
    .order("position", { ascending: true });

  // Group flat lesson list into chapters by module_title, preserving order.
  const chapters: { title: string; lessons: NonNullable<typeof videos> }[] = [];
  for (const v of videos ?? []) {
    let chapter = chapters.find((c) => c.title === v.module_title);
    if (!chapter) {
      chapter = { title: v.module_title, lessons: [] };
      chapters.push(chapter);
    }
    chapter.lessons.push(v);
  }

  // What this student has already ticked off. Read server-side alongside the
  // lessons so the course opens showing their real position rather than
  // flashing zero and filling in afterwards.
  const { data: done } = await supabase
    .from("lesson_progress")
    .select("video_id")
    .eq("user_id", user.id);

  return (
    <CourseViewer
      courseTitle={course.title}
      chapters={chapters}
      userId={user.id}
      initialCompleted={(done ?? []).map((d) => d.video_id as string)}
    />
  );
}
