"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addLessons,
  deleteCourse,
  deleteLesson,
  reorderLessons,
  updateCourse,
  updateLesson,
} from "../../actions";

type Lesson = {
  id: string;
  title: string;
  module_title: string;
  source_id: string;
  source_type: string;
  position: number;
};

type Course = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  bigcommerce_product_id: number;
};

export function CourseEditor({
  course,
  lessons,
  buyers,
}: {
  course: Course;
  lessons: Lesson[];
  buyers: number;
}) {
  return (
    <div>
      <p className="page-eyebrow" style={{ marginTop: 18 }}>
        {buyers} student{buyers === 1 ? "" : "s"} · product {course.bigcommerce_product_id}
      </p>
      <h1 className="page-title">{course.title}</h1>
      <p className="page-sub">
        Students open this at{" "}
        <Link href={`/course/${course.slug}`} className="link">
          /course/{course.slug}
        </Link>
      </p>

      <LessonManager courseId={course.id} initial={lessons} />
      <CourseSettings course={course} buyers={buyers} />
    </div>
  );
}

function LessonManager({ courseId, initial }: { courseId: string; initial: Lesson[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [order, setOrder] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // A server refresh is the source of truth; adopt it whenever it changes.
  useEffect(() => setOrder(initial), [initial]);

  function persistOrder(next: Lesson[]) {
    setOrder(next);
    setError("");
    start(async () => {
      const result = await reorderLessons({ courseId, orderedIds: next.map((l) => l.id) });
      if (!result.ok) {
        setError(result.error);
        setOrder(initial); // put it back rather than show a lie
      }
      router.refresh();
    });
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    persistOrder(next);
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = order.findIndex((l) => l.id === dragId);
    const to = order.findIndex((l) => l.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragId(null);
    persistOrder(next);
  }

  function remove(lesson: Lesson) {
    if (!confirm(`Delete “${lesson.title}”? This can't be undone.`)) return;
    setError("");
    start(async () => {
      const result = await deleteLesson({ id: lesson.id, courseId });
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  let lastChapter = "";

  return (
    <section style={{ marginTop: 12 }}>
      <div className="admin-section-head">
        <h2>Lessons</h2>
        <span>{order.length} total</span>
      </div>

      {error && <p className="auth-error">{error}</p>}
      {notice && <p className="admin-notice">{notice}</p>}

      {order.length === 0 ? (
        <div className="empty-state" style={{ padding: "32px 24px" }}>
          No lessons yet. Paste your YouTube links below to fill this course.
        </div>
      ) : (
        <div className="lesson-list">
          {order.map((lesson, i) => {
            const newChapter = lesson.module_title !== lastChapter;
            lastChapter = lesson.module_title;
            return (
              <div key={lesson.id}>
                {newChapter && <p className="lesson-chapter">{lesson.module_title}</p>}
                <LessonRow
                  lesson={lesson}
                  courseId={courseId}
                  index={i}
                  total={order.length}
                  busy={pending}
                  onMove={move}
                  onDelete={remove}
                  onDragStart={() => setDragId(lesson.id)}
                  onDropOn={() => onDrop(lesson.id)}
                  dragging={dragId === lesson.id}
                />
              </div>
            );
          })}
        </div>
      )}

      <BulkAdd
        courseId={courseId}
        onAdded={(n) => {
          setNotice(`Added ${n} lesson${n === 1 ? "" : "s"}.`);
          setTimeout(() => setNotice(""), 4000);
        }}
      />
    </section>
  );
}

function LessonRow({
  lesson,
  courseId,
  index,
  total,
  busy,
  onMove,
  onDelete,
  onDragStart,
  onDropOn,
  dragging,
}: {
  lesson: Lesson;
  courseId: string;
  index: number;
  total: number;
  busy: boolean;
  onMove: (index: number, delta: number) => void;
  onDelete: (lesson: Lesson) => void;
  onDragStart: () => void;
  onDropOn: () => void;
  dragging: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(lesson.title);
  const [chapter, setChapter] = useState(lesson.module_title);
  const [url, setUrl] = useState(lesson.source_id);
  const [error, setError] = useState("");

  function save() {
    setError("");
    start(async () => {
      const result = await updateLesson({ id: lesson.id, courseId, title, chapter, url });
      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (editing) {
    return (
      <div className="lesson-row lesson-row-editing">
        <div style={{ flex: 1 }}>
          <div className="admin-grid">
            <div>
              <label className="field-label">Lesson title</label>
              <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Chapter</label>
              <input className="field-input" value={chapter} onChange={(e) => setChapter(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field-label">YouTube or Google Drive link</label>
            <input className="field-input" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button className="btn admin-sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              className="btn-ghost admin-sm"
              onClick={() => {
                setTitle(lesson.title);
                setChapter(lesson.module_title);
                setUrl(lesson.source_id);
                setError("");
                setEditing(false);
              }}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`lesson-row${dragging ? " lesson-row-dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropOn}
    >
      <span className="lesson-grip" aria-hidden="true">⋮⋮</span>
      <span className="lesson-num">{index + 1}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="lesson-title">{lesson.title}</div>
        <div className="lesson-meta">
          {lesson.source_type === "pdf" && <span className="lesson-kind">PDF</span>}
          {lesson.source_id}
        </div>
      </div>
      {/* Arrows keep reordering usable without a mouse. */}
      <button
        className="icon-btn"
        onClick={() => onMove(index, -1)}
        disabled={busy || index === 0}
        aria-label={`Move ${lesson.title} up`}
      >
        ↑
      </button>
      <button
        className="icon-btn"
        onClick={() => onMove(index, 1)}
        disabled={busy || index === total - 1}
        aria-label={`Move ${lesson.title} down`}
      >
        ↓
      </button>
      <button className="btn-ghost admin-sm" onClick={() => setEditing(true)}>
        Edit
      </button>
      <button className="icon-btn icon-btn-danger" onClick={() => onDelete(lesson)} aria-label={`Delete ${lesson.title}`}>
        ×
      </button>
    </div>
  );
}

function BulkAdd({ courseId, onAdded }: { courseId: string; onAdded: (n: number) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [chapter, setChapter] = useState("");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const result = await addLessons({ courseId, defaultChapter: chapter, text });
      if (result.ok) {
        onAdded(result.added ?? 0);
        setText("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form className="admin-card" onSubmit={submit} style={{ marginTop: 28 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", margin: "0 0 6px" }}>
        Add lessons
      </h3>
      <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "0 0 18px", lineHeight: 1.6 }}>
        One lesson per line. Paste as many as you like at once.
      </p>

      <div style={{ maxWidth: 320, marginBottom: 16 }}>
        <label className="field-label" htmlFor="chapter">Chapter for these lessons</label>
        <input
          id="chapter"
          className="field-input"
          value={chapter}
          onChange={(e) => setChapter(e.target.value)}
          placeholder="Getting started"
        />
      </div>

      <label className="field-label" htmlFor="bulk">Lessons</label>
      <textarea
        id="bulk"
        className="field-input admin-mono"
        rows={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          "Welcome and what to expect | https://youtu.be/dQw4w9WgXcQ\n" +
          "Tools you will need | https://www.youtube.com/watch?v=abc123xyz45\n" +
          "Consultations | Reading hair loss patterns | https://youtu.be/def456uvw78"
        }
      />
      <p className="admin-hint">
        <strong>Title | link</strong> uses the chapter above.{" "}
        <strong>Chapter | title | link</strong> overrides it for that line. A bare link
        works too. YouTube links become videos; Google Drive links become documents.
      </p>

      {error && <p className="auth-error">{error}</p>}

      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 18 }}>
        {pending ? "Adding…" : "Add lessons"}
      </button>
    </form>
  );
}

function CourseSettings({ course, buyers }: { course: Course; buyers: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(course.title);
  const [slug, setSlug] = useState(course.slug);
  const [description, setDescription] = useState(course.description ?? "");
  const [productId, setProductId] = useState(String(course.bigcommerce_product_id));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    start(async () => {
      const result = await updateCourse({ id: course.id, title, slug, description, productId });
      if (result.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove() {
    if (!confirm(`Delete “${course.title}” and all its lessons? This can't be undone.`)) return;
    setError("");
    start(async () => {
      const result = await deleteCourse(course.id);
      if (result.ok) router.push("/admin");
      else setError(result.error);
    });
  }

  return (
    <section style={{ marginTop: 48 }}>
      <div className="admin-section-head">
        <h2>Course settings</h2>
      </div>
      <form className="admin-card" onSubmit={save}>
        <div className="admin-grid">
          <div>
            <label className="field-label">Course title</label>
            <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="field-label">BigCommerce product ID</label>
            <input
              className="field-input"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              inputMode="numeric"
            />
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <label className="field-label">Web address</label>
          <input className="field-input" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <p className="admin-hint">
            Changing this breaks any link to the old address that students have saved.
          </p>
        </div>
        <div style={{ marginTop: 18 }}>
          <label className="field-label">Description</label>
          <textarea
            className="field-input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {error && <p className="auth-error">{error}</p>}
        {saved && <p className="admin-notice">Saved.</p>}

        <div style={{ display: "flex", gap: 12, marginTop: 20, alignItems: "center" }}>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            className="btn-ghost admin-danger"
            onClick={remove}
            disabled={pending || buyers > 0}
            title={
              buyers > 0
                ? "Students have bought this course, so it can't be deleted"
                : "Delete this course"
            }
          >
            Delete course
          </button>
          {buyers > 0 && (
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {buyers} student{buyers === 1 ? "" : "s"} own this — deleting is blocked.
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
