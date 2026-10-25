"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { emailOriginOrReason } from "@/lib/origin";
import { supabaseAdmin } from "@/lib/supabase-server";
import { currentAdmin, isOwnerEmail, ownerEmails } from "@/lib/admin";
import { parseLessonSource, slugify } from "@/lib/lesson-source";
import { sendCourseWelcome, SIGN_IN_LINK_HOURS } from "@/lib/onboarding";

export type Result = { ok: true } | { ok: false; error: string };

// Writes go through the service-role client, which bypasses RLS — so the
// admin check has to happen here, in every single action. Never rely on
// the page having rendered: anyone can POST to a server action directly.
async function guard(): Promise<Result> {
  const admin = await currentAdmin();
  return admin ? { ok: true } : { ok: false, error: "Not authorised." };
}

export async function createCourse(input: {
  title: string;
  slug: string;
  description: string;
  productId: string;
}): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the course a title." };

  const slug = slugify(input.slug.trim() || title);
  if (!slug) return { ok: false, error: "That title doesn't produce a usable web address — add some letters or numbers." };

  const productId = Number(input.productId.trim());
  if (!Number.isInteger(productId) || productId <= 0) {
    return { ok: false, error: "The BigCommerce product ID must be a whole number, e.g. 3463." };
  }

  const { error } = await supabaseAdmin().from("courses").insert({
    title,
    slug,
    description: input.description.trim() || null,
    bigcommerce_product_id: productId,
  });

  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/admin");
  return { ok: true };
}

export async function updateCourse(input: {
  id: string;
  title: string;
  slug: string;
  description: string;
  productId: string;
}): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the course a title." };

  const slug = slugify(input.slug.trim() || title);
  if (!slug) return { ok: false, error: "That web address isn't usable — add some letters or numbers." };

  const productId = Number(input.productId.trim());
  if (!Number.isInteger(productId) || productId <= 0) {
    return { ok: false, error: "The BigCommerce product ID must be a whole number, e.g. 3463." };
  }

  const { error } = await supabaseAdmin()
    .from("courses")
    .update({
      title,
      slug,
      description: input.description.trim() || null,
      bigcommerce_product_id: productId,
    })
    .eq("id", input.id);

  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/admin");
  revalidatePath(`/admin/course/${input.id}`);
  return { ok: true };
}

export async function deleteCourse(id: string): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;

  const admin = supabaseAdmin();

  // Deleting a course cascades to its purchases, which would silently strip
  // paying students of access. Refuse while anyone owns it.
  const { count, error: countError } = await admin
    .from("purchases")
    .select("id", { count: "exact", head: true })
    .eq("course_id", id);

  if (countError) return { ok: false, error: friendly(countError.message) };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} student${count === 1 ? " has" : "s have"} bought this course. Deleting it would remove their access, so it can't be deleted.`,
    };
  }

  const { error } = await admin.from("courses").delete().eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/admin");
  return { ok: true };
}

// Bulk add. Each line is one lesson, in any of these shapes:
//   Chapter | Lesson title | https://youtu.be/xxxx
//   Lesson title | https://youtu.be/xxxx
//   https://youtu.be/xxxx
// A Google Drive share link works in place of a YouTube one, for written
// material like the manual or consultation form.
export async function addLessons(input: {
  courseId: string;
  defaultChapter: string;
  text: string;
}): Promise<Result & { added?: number }> {
  const g = await guard();
  if (!g.ok) return g;

  const admin = supabaseAdmin();
  const fallbackChapter = input.defaultChapter.trim() || "Lessons";

  const lines = input.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { ok: false, error: "Paste at least one lesson." };

  // Continue numbering after whatever is already in the course.
  const { data: last } = await admin
    .from("course_videos")
    .select("position")
    .eq("course_id", input.courseId)
    .order("position", { ascending: false })
    .limit(1);

  let position = (last?.[0]?.position ?? 0) + 1;

  const rows: {
    course_id: string;
    module_title: string;
    title: string;
    source_id: string;
    source_type: string;
    position: number;
  }[] = [];

  for (const [i, line] of lines.entries()) {
    const parts = line.split("|").map((p) => p.trim());
    const urlPart = parts[parts.length - 1];
    const source = parseLessonSource(urlPart);

    if (!source) {
      return {
        ok: false,
        error: `Line ${i + 1} doesn't contain a YouTube or Google Drive link: "${truncate(line)}". Nothing was added — fix that line and try again.`,
      };
    }

    const chapter = parts.length >= 3 ? parts[0] || fallbackChapter : fallbackChapter;
    const title =
      parts.length >= 3 ? parts[1] : parts.length === 2 ? parts[0] : `Lesson ${position}`;

    rows.push({
      course_id: input.courseId,
      module_title: chapter,
      title: title || `Lesson ${position}`,
      source_id: source.id,
      source_type: source.type,
      position: position++,
    });
  }

  const { error } = await admin.from("course_videos").insert(rows);
  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath(`/admin/course/${input.courseId}`);
  return { ok: true, added: rows.length };
}

export async function updateLesson(input: {
  id: string;
  courseId: string;
  title: string;
  chapter: string;
  url: string;
}): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;

  const title = input.title.trim();
  if (!title) return { ok: false, error: "The lesson needs a title." };

  const source = parseLessonSource(input.url);
  if (!source) {
    return { ok: false, error: "That isn't a YouTube or Google Drive link." };
  }

  const { error } = await supabaseAdmin()
    .from("course_videos")
    .update({
      title,
      module_title: input.chapter.trim() || "Lessons",
      source_id: source.id,
      source_type: source.type,
    })
    .eq("id", input.id);

  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath(`/admin/course/${input.courseId}`);
  return { ok: true };
}

export async function deleteLesson(input: { id: string; courseId: string }): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;

  const { error } = await supabaseAdmin().from("course_videos").delete().eq("id", input.id);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath(`/admin/course/${input.courseId}`);
  return { ok: true };
}

// Takes the full lesson order after a drag and writes only the rows whose
// position actually moved, in small batches — a 60-lesson course would
// otherwise fire 60 requests for a one-place nudge.
export async function reorderLessons(input: {
  courseId: string;
  orderedIds: string[];
}): Promise<Result> {
  const g = await guard();
  if (!g.ok) return g;

  const admin = supabaseAdmin();
  const { data: current, error: readError } = await admin
    .from("course_videos")
    .select("id, position")
    .eq("course_id", input.courseId);

  if (readError) return { ok: false, error: friendly(readError.message) };

  const currentPos = new Map((current ?? []).map((r) => [r.id, r.position]));
  const changed = input.orderedIds
    .map((id, index) => ({ id, position: index + 1 }))
    .filter((row) => currentPos.has(row.id) && currentPos.get(row.id) !== row.position);

  for (let i = 0; i < changed.length; i += 10) {
    const batch = changed.slice(i, i + 10);
    const results = await Promise.all(
      batch.map((row) =>
        admin.from("course_videos").update({ position: row.position }).eq("id", row.id)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return { ok: false, error: friendly(failed.error.message) };
  }

  revalidatePath(`/admin/course/${input.courseId}`);
  return { ok: true };
}

// Postgres constraint errors are unreadable for non-developers.
function friendly(message: string) {
  if (message.includes("courses_slug_key")) {
    return "Another course already uses that web address. Pick a different one.";
  }
  if (message.includes("courses_bigcommerce_product_id_key")) {
    return "Another course is already linked to that BigCommerce product ID.";
  }
  return message;
}

function truncate(s: string) {
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}


// ---------- Staff access ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function originFromHeaders() {
  return emailOriginOrReason(await headers(), "an admin-sent welcome");
}

// Giving a colleague the keys and telling nobody is the same bug we already
// fixed for students: the row goes in, the screen says they have access, and
// they sit waiting for an email that was never written. So adding staff
// creates their account and sends the invite, and says plainly if it fails.
//
// Access is granted either way. A mail server having a bad minute must not
// leave half the job done, with a colleague who is an admin in the database
// and nowhere else.
export async function inviteStaff(
  emailInput: string
): Promise<Result & { emailed?: boolean; emailError?: string; linkHours?: number }> {
  const session = await currentAdmin();
  if (!session) return { ok: false, error: "Not authorised." };

  const email = emailInput.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That doesn't look like an email address." };

  const admin = supabaseAdmin();

  // They may already be a student, or a colleague who was added before this
  // sent anything; either way we want the existing account, not a second one.
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true, // a colleague vouched for them
  });
  if (createError && !(await findUserIdByEmail(email))) {
    return { ok: false, error: createError.message };
  }
  const userId = await findUserIdByEmail(email);

  // Staff get every course. They are expected to answer questions about any
  // of them, and cannot do that from the admin screens alone — a lesson looks
  // different to the student reading it. Doing this on every invite, rather
  // than only on the first, means a course added next year reaches the people
  // who already work here the next time anyone is invited or re-invited.
  const courseTitles = userId ? await grantEveryCourse(userId) : [];

  const where = await originFromHeaders();
  const mail = where.origin
    ? await sendCourseWelcome({
        to: email,
        courseTitles,
        origin: where.origin,
        kind: "staff",
        userId: userId ?? undefined,
      })
    : { sent: false as const, reason: where.reason };

  revalidatePath("/admin");
  return { ok: true, emailed: mail.sent, emailError: mail.reason, linkHours: SIGN_IN_LINK_HOURS };
}

export async function addAdmin(
  emailInput: string
): Promise<Result & { emailed?: boolean; emailError?: string; linkHours?: number }> {
  const session = await currentAdmin();
  if (!session) return { ok: false, error: "Not authorised." };

  const email = emailInput.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That doesn't look like an email address." };

  if (isOwnerEmail(email)) {
    return { ok: false, error: `${email} already has permanent access.` };
  }

  const { error } = await supabaseAdmin()
    .from("admins")
    .insert({ email, added_by: session.user.email ?? null });

  if (error) {
    if (error.message.includes("admins_email_key")) {
      return { ok: false, error: `${email} already has staff access.` };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  return await inviteStaff(email);
}

// 0 as the order id marks access given by hand rather than bought, the same
// convention the student path uses. Upserted, so running it again is a no-op
// and never disturbs a course they really did buy.
async function grantEveryCourse(userId: string): Promise<string[]> {
  const admin = supabaseAdmin();
  const { data: courses } = await admin
    .from("courses")
    .select("id, title")
    .order("bigcommerce_product_id", { ascending: true });
  if (!courses?.length) return [];

  const { error } = await admin.from("purchases").upsert(
    courses.map((c) => ({ user_id: userId, course_id: c.id, bigcommerce_order_id: 0 })),
    { onConflict: "user_id,course_id", ignoreDuplicates: true }
  );
  if (error) {
    // The invite is still worth sending; they just see fewer courses.
    console.error("[staff] could not grant every course:", error.message);
  }

  const { data: owned } = await admin
    .from("purchases")
    .select("course:courses(title)")
    .eq("user_id", userId);
  return (owned ?? [])
    .map((p) => (p.course as unknown as { title: string } | null)?.title)
    .filter((t): t is string => Boolean(t));
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = supabaseAdmin();
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

export async function removeAdmin(email: string): Promise<Result> {
  const session = await currentAdmin();
  if (!session) return { ok: false, error: "Not authorised." };

  const target = email.trim().toLowerCase();

  // Two guards against locking people out of the tools by accident.
  if (target === session.user.email?.toLowerCase()) {
    return { ok: false, error: "You can't remove your own access. Ask a colleague to do it." };
  }
  if (isOwnerEmail(target)) {
    return {
      ok: false,
      error: `${target} has permanent access set in the server configuration, so it can't be removed here.`,
    };
  }

  const { error } = await supabaseAdmin().from("admins").delete().eq("email", target);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}
