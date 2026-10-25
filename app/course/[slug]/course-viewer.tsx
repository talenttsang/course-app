"use client";
import { useState } from "react";
import Link from "next/link";
import { TopNav, ProtectedPlayer } from "../../components";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Lesson = { id: string; title: string; source_id: string; source_type: string };
type Chapter = { title: string; lessons: Lesson[] };

// Client component: handles which lesson is open and which chapters
// are expanded.
//
// Completion used to live in React state and nowhere else, so every tick
// vanished on reload. A student working through the course saw it reset to
// zero each time she came back and reasonably concluded we had no record of
// her doing it — which we did not. It is now a row per lesson in
// lesson_progress, written as the student, with row-level security so
// nobody can read or touch anyone else's.
export function CourseViewer({
  courseTitle,
  chapters,
  userId,
  initialCompleted,
}: {
  courseTitle: string;
  chapters: Chapter[];
  userId: string;
  initialCompleted: string[];
}) {
  const firstLesson = chapters[0]?.lessons[0];
  const [openChapter, setOpenChapter] = useState(chapters[0]?.title ?? "");
  const [activeLesson, setActiveLesson] = useState<Lesson | undefined>(firstLesson);
  const [completed, setCompleted] = useState<Set<string>>(new Set(initialCompleted));
  // A failed save that still showed a tick would be the original bug wearing
  // a disguise: the student believes it is recorded, and it is not.
  const [saveError, setSaveError] = useState("");

  const totalLessons = chapters.reduce((n, c) => n + c.lessons.length, 0);
  const progress = totalLessons > 0 ? Math.round((completed.size / totalLessons) * 100) : 0;

  // Flat lesson order, for "complete and continue" advancing.
  const flat = chapters.flatMap((c) => c.lessons);

  // Returns whether the lesson ended up in the state that was asked for.
  // It used to return nothing, so callers could not tell a saved tick from a
  // failed one — and the only caller moved on to the next lesson either way.
  async function setDone(lessonId: string, done: boolean): Promise<boolean> {
    // Already in the state being asked for: nothing to write, and writing
    // anyway is how "Next lesson" on a finished lesson turns into an error.
    if (completed.has(lessonId) === done) return true;

    // Move the tick first — waiting on the network to redraw a checkbox
    // feels broken — then put it back if the write does not land.
    setCompleted((prev) => {
      const next = new Set(prev);
      if (done) next.add(lessonId);
      else next.delete(lessonId);
      return next;
    });
    setSaveError("");

    const db = supabaseBrowser();
    const { error } = done
      ? await db.from("lesson_progress").upsert(
          { user_id: userId, video_id: lessonId },
          // Ignore rather than merge on conflict: merging asks the database
          // for an UPDATE, which a student has no policy for and does not
          // need — a lesson is finished or it is not, and re-ticking one
          // should quietly do nothing.
          { onConflict: "user_id,video_id", ignoreDuplicates: true }
        )
      : await db.from("lesson_progress").delete().eq("user_id", userId).eq("video_id", lessonId);

    if (error) {
      setCompleted((prev) => {
        const next = new Set(prev);
        if (done) next.delete(lessonId);
        else next.add(lessonId);
        return next;
      });
      setSaveError(
        "We could not save that just now — check your connection and try again. " +
          "Your place in the course is safe; this lesson simply has not been ticked off."
      );
      return false;
    }
    return true;
  }

  async function completeAndContinue() {
    if (!activeLesson) return;

    // Stay put if the tick did not save. Advancing anyway left the student on
    // the next lesson reading "this lesson simply has not been ticked off" —
    // about a lesson they never ticked, while the one that actually failed
    // scrolled out of view with its tick quietly removed. A wrong explanation
    // is worse than a bare failure, because it sends them to fix the wrong
    // thing.
    if (!(await setDone(activeLesson.id, true))) return;

    const idx = flat.findIndex((l) => l.id === activeLesson.id);
    const next = flat[idx + 1];
    if (next) {
      setActiveLesson(next);
      const owner = chapters.find((c) => c.lessons.some((l) => l.id === next.id));
      if (owner) setOpenChapter(owner.title);
    }
  }

  if (!activeLesson) {
    return (
      <div>
        <TopNav label="COURSE" />
        <div className="page-wrap" style={{ maxWidth: 640 }}>
          <div className="empty-state">
            <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--ink)" }}>
              Lessons coming soon
            </p>
            This course doesn&apos;t have published lessons yet — check back shortly.
            <div style={{ marginTop: 18 }}>
              <Link href="/dashboard" className="btn-ghost">
                ← Back to dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopNav label="COURSE" />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <aside
          style={{
            width: 340,
            flexShrink: 0,
            background: "#fff",
            borderRight: "1px solid var(--border)",
            padding: "24px 22px",
            overflowY: "auto",
          }}
        >
          <Link href="/dashboard" className="link" style={{ fontSize: 13 }}>
            ← Back to dashboard
          </Link>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)", margin: "16px 0 14px", lineHeight: 1.4 }}>
            {courseTitle}
          </h1>
          <div className="progress-track" style={{ marginBottom: 8 }}>
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 22px" }}>
            {completed.size} of {totalLessons} lessons · {progress}% complete
          </p>

          {chapters.map((chapter) => {
            const done = chapter.lessons.filter((l) => completed.has(l.id)).length;
            const isOpen = openChapter === chapter.title;
            return (
              <div key={chapter.title} style={{ marginBottom: 6 }}>
                <button
                  onClick={() => setOpenChapter(isOpen ? "" : chapter.title)}
                  style={{
                    width: "100%",
                    background: "none",
                    border: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 2px",
                    borderBottom: "1px solid var(--border)",
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)", textAlign: "left" }}>
                    {chapter.title}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--muted)", flexShrink: 0, marginLeft: 10 }}>
                    {done}/{chapter.lessons.length} {isOpen ? "▾" : "▸"}
                  </span>
                </button>
                {isOpen && (
                  <div style={{ padding: "6px 0" }}>
                    {chapter.lessons.map((lesson) => {
                      const isActive = activeLesson.id === lesson.id;
                      const isDone = completed.has(lesson.id);
                      return (
                        <button
                          key={lesson.id}
                          onClick={() => setActiveLesson(lesson)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            background: isActive ? "#fdf0f2" : "none",
                            border: "none",
                            borderRadius: 8,
                            padding: "10px 10px",
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            fontFamily: "inherit",
                          }}
                        >
                          <span
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: "50%",
                              border: isDone ? "none" : "1.5px solid #cfcfcf",
                              background: isDone ? "var(--brand)" : "none",
                              color: "#fff",
                              fontSize: 11,
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: 2,
                            }}
                          >
                            {isDone ? "✓" : ""}
                          </span>
                          <span
                            style={{
                              fontSize: 13.5,
                              lineHeight: 1.45,
                              color: isActive ? "var(--brand)" : "var(--text)",
                              fontWeight: isActive ? 600 : 400,
                            }}
                          >
                            {lesson.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: "18px 32px",
              borderBottom: "1px solid var(--border)",
              background: "#fff",
            }}
          >
            <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)", margin: 0 }}>
              {activeLesson.title}
            </h2>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              background: "#0d0d0d",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 12,
            }}
          >
            <div
              style={
                activeLesson.source_type === "pdf"
                  ? { width: "100%", height: "100%" }
                  : {
                      width: "100%",
                      maxWidth: "calc((100vh - 220px) * 16 / 9)",
                      aspectRatio: "16 / 9",
                      maxHeight: "100%",
                    }
              }
            >
              <ProtectedPlayer
                sourceType={activeLesson.source_type}
                sourceId={activeLesson.source_id}
                title={activeLesson.title}
              />
            </div>
          </div>
          <div
            style={{
              padding: "16px 32px",
              borderTop: "1px solid var(--border)",
              background: "#fff",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            {saveError && (
              <p
                className="auth-error"
                style={{ margin: 0, marginRight: "auto", maxWidth: 520, fontSize: 13 }}
              >
                {saveError}
              </p>
            )}
            {completed.has(activeLesson.id) && (
              <button
                className="btn-ghost"
                style={{ marginRight: 10 }}
                onClick={() => setDone(activeLesson.id, false)}
              >
                Mark as not done
              </button>
            )}
            <button className="btn" onClick={completeAndContinue}>
              {completed.has(activeLesson.id) ? "Next lesson →" : "Complete and continue →"}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
