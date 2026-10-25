"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { emailOriginOrReason } from "@/lib/origin";
import { supabaseAdmin } from "@/lib/supabase-server";
import { currentAdmin } from "@/lib/admin";
import { sendCourseWelcome, SIGN_IN_LINK_HOURS } from "@/lib/onboarding";
import { rememberStudentName } from "@/lib/students";
import { localeForCourses } from "@/lib/i18n";

export type Result = { ok: true } | { ok: false; error: string };

async function originFromHeaders() {
  return emailOriginOrReason(await headers(), "an admin-sent welcome");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Manual grants exist because the automatic path keys access to the email
// used at checkout. Someone who paid with a work address and signs in with
// a personal one is the single most common support case, and this is how
// staff fix it without touching the database.
export async function grantCourse(input: { userId: string; courseId: string }): Promise<Result> {
  const session = await currentAdmin();
  if (!session) return { ok: false, error: "Not authorised." };

  const { error } = await supabaseAdmin()
    .from("purchases")
    .upsert(
      // 0 marks access given by hand rather than by a BigCommerce order, so
      // the two are still tellable apart later.
      { user_id: input.userId, course_id: input.courseId, bigcommerce_order_id: 0 },
      { onConflict: "user_id,course_id" }
    );

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/students/${input.userId}`);
  revalidatePath("/admin/students");
  return { ok: true };
}

export async function revokeCourse(input: { userId: string; courseId: string }): Promise<Result> {
  const session = await currentAdmin();
  if (!session) return { ok: false, error: "Not authorised." };

  const { error } = await supabaseAdmin()
    .from("purchases")
    .delete()
    .eq("user_id", input.userId)
    .eq("course_id", input.courseId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/students/${input.userId}`);
  revalidatePath("/admin/students");
  return { ok: true };
}

// For sales taken outside the store — over the phone, in a salon, on a
// storefront whose API token we don't hold, or a comped place — where there
// is no BigCommerce order to onboard from the Waiting page.
//
// Sends the same welcome email order onboarding does, unless the caller opts out
// because they intend to write to the student themselves. Granting access
// silently is the one way to get this wrong: the buyer has paid, and has no
// way of discovering a course nobody told them about.
export async function createStudent(input: {
  email: string;
  courseId: string;
  notify?: boolean;
  name?: string;
}): Promise<Result & { userId?: string; emailed?: boolean; emailError?: string }> {
  const session = await currentAdmin();
  if (!session) return { ok: false, error: "Not authorised." };

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }

  const admin = supabaseAdmin();
  const studentName = (input.name ?? "").trim() || null;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true, // staff vouched for them; don't make them confirm
    ...(studentName ? { user_metadata: { full_name: studentName } } : {}),
  });

  let userId = created?.user?.id;

  if (error) {
    // Already a student — treat this as "give them this course too" rather
    // than an error, which is what staff meant by it.
    const existing = await findByEmail(email);
    if (!existing) return { ok: false, error: error.message };
    userId = existing;
  }

  if (!userId) return { ok: false, error: "Could not create that student." };

  // An account that already existed may predate us recording names.
  if (error) await rememberStudentName(userId, studentName);

  const titles: string[] = [];
  if (input.courseId) {
    const granted = await grantCourse({ userId, courseId: input.courseId });
    if (!granted.ok) return granted;

    const { data: course } = await admin
      .from("courses")
      .select("title")
      .eq("id", input.courseId)
      .single();
    if (course?.title) titles.push(course.title);
  }

  revalidatePath("/admin/students");

  // Access is granted either way; the email is a best-effort extra, so a
  // mail failure is reported alongside the success rather than replacing it.
  if (input.notify === false || titles.length === 0) {
    return { ok: true, userId, emailed: false };
  }
  const where = await originFromHeaders();
  const mail = where.origin
    ? await sendCourseWelcome({
        to: email,
        courseTitles: titles,
        origin: where.origin,
        userId,
      })
    : { sent: false as const, reason: where.reason };

  return { ok: true, userId, emailed: mail.sent, emailError: mail.reason };
}

// A sign-in link is good for 24 hours, so every student who does not open
// the welcome the day it arrives is locked out of a course they own until
// somebody can send another one. They can self-serve from the login page,
// but only if they think to — the ones who write in instead are exactly the
// ones who assume the purchase failed.
//
// This re-sends the same welcome, in the same language, with a fresh link.
// It is deliberately a resend rather than a bare link: a student who lost
// the first email has no context either, and the welcome carries both.
export async function resendWelcome(userId: string): Promise<
  Result & { emailed?: boolean; emailError?: string; linkHours?: number }
> {
  const session = await currentAdmin();
  if (!session) return { ok: false, error: "Not authorised." };

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) {
    return { ok: false, error: "Could not find that student." };
  }
  const email = data.user.email;

  const { data: purchases } = await admin
    .from("purchases")
    .select("bigcommerce_order_id, course:courses(title, bigcommerce_product_id)")
    .eq("user_id", userId);

  const rows = (purchases ?? [])
    .map((p) => ({
      orderId: p.bigcommerce_order_id as number | null,
      course: p.course as unknown as { title: string; bigcommerce_product_id: number } | null,
    }))
    .filter((r) => r.course);

  // Welcoming someone to no courses would be a worse email than none.
  if (rows.length === 0) {
    return {
      ok: false,
      error: "This student has no course yet, so there is nothing to send them.",
    };
  }

  // The wording follows how they actually got access, so a staff grant is
  // never dressed up as a purchase they did not make.
  const boughtIt = rows.some((r) => r.orderId !== null && r.orderId !== 0);

  const where = await originFromHeaders();
  const mail = where.origin
    ? await sendCourseWelcome({
        to: email,
        courseTitles: rows.map((r) => r.course!.title),
        origin: where.origin,
        locale: localeForCourses(rows.map((r) => r.course!.bigcommerce_product_id)),
        kind: boughtIt ? "purchase" : "granted",
        userId,
      })
    : { sent: false as const, reason: where.reason };

  revalidatePath(`/admin/students/${userId}`);
  revalidatePath("/admin/students");

  return {
    ok: true,
    emailed: mail.sent,
    emailError: mail.reason,
    linkHours: SIGN_IN_LINK_HOURS,
  };
}

// A buyer who mistypes their address at checkout — ocallaghancutz@gmail.co
// for .com — gets an account at an address that does not exist, a welcome
// email that silently goes nowhere, and no way in. Until now the only fix
// was to delete the account and rebuild it, which throws away their course
// access and their place in the records.
//
// Course access hangs off the account id, not the address, so correcting
// the address keeps everything they own.
export async function changeStudentEmail(input: {
  userId: string;
  email: string;
}): Promise<Result & { email?: string; needsWelcome?: boolean }> {
  const session = await currentAdmin();
  if (!session) return { ok: false, error: "Not authorised." };

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }

  const admin = supabaseAdmin();
  const { data: existing, error: readError } = await admin.auth.admin.getUserById(input.userId);
  if (readError || !existing.user) return { ok: false, error: "Could not find that student." };

  const current = (existing.user.email ?? "").toLowerCase();
  if (current === email) {
    return { ok: false, error: "That is already their email address." };
  }

  // Checked here rather than left to the database, so the message says what
  // actually happened instead of surfacing a constraint name.
  const clash = await findByEmail(email);
  if (clash && clash !== input.userId) {
    return {
      ok: false,
      error: `${email} already belongs to another student. Merge them by hand, or use a different address.`,
    };
  }

  const meta = { ...(existing.user.user_metadata ?? {}) } as Record<string, unknown>;

  // Keep the old address: support will be looking for the person by whatever
  // they were first told, and this is the only record that it ever existed.
  const previous = Array.isArray(meta.previous_emails) ? (meta.previous_emails as string[]) : [];
  if (current) meta.previous_emails = [...previous, current];

  // Whatever we sent went to an address that was never theirs, so they have
  // not been told anything. Saying otherwise on the student page is how they
  // end up waiting while staff believe the job is done.
  meta.welcome_sent_at = null;
  meta.welcome_error = null;

  const { error } = await admin.auth.admin.updateUserById(input.userId, {
    email,
    email_confirm: true, // staff corrected it; don't make the student confirm
    user_metadata: meta,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/students/${input.userId}`);
  revalidatePath("/admin/students");
  return { ok: true, email, needsWelcome: true };
}

export async function deleteStudent(userId: string): Promise<Result> {
  const session = await currentAdmin();
  if (!session) return { ok: false, error: "Not authorised." };

  const admin = supabaseAdmin();

  // Deleting your own account would sign you out mid-action and, if you are
  // the only admin, leave nobody able to undo it.
  if (userId === session.user.id) {
    return { ok: false, error: "You can't delete your own account here." };
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/students");
  return { ok: true };
}

async function findByEmail(email: string): Promise<string | null> {
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
