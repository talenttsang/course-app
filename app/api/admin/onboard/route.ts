import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { emailOriginOrReason } from "@/lib/origin";
import { isAdmin } from "@/lib/admin";
import { sendCourseWelcome } from "@/lib/onboarding";
import { localeForProduct, type WelcomeKind } from "@/lib/i18n";
import { rememberStudentName } from "@/lib/students";

// Onboarding by email and product, without a BigCommerce order to read.
//
// We sell the same courses across several storefronts, and an order on a
// store whose API token we don't hold can't be read from the admin Waiting
// page — reading it needs the token for the store it lives in. Those buyers,
// and anyone migrated from elsewhere, are onboarded by email instead.
//
// The admin UI can do it one at a time. This does the same thing over HTTP,
// so a batch of them can be worked through from a script or another system
// without anyone clicking through a form 40 times.
//
// Auth is the caller's own Supabase access token — the one the browser
// already holds after signing in — and it must belong to an admin. No new
// shared secret to leak, and access can be revoked by removing them from
// staff, exactly like the UI.

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: caller, error: authError } = await admin.auth.getUser(token);
  if (authError || !caller.user || !(await isAdmin(caller.user.email))) {
    return NextResponse.json({ error: "not an admin" }, { status: 403 });
  }

  let body: {
    email?: string;
    productId?: number;
    notify?: boolean;
    // "migration" tells a student carried over from the old platform what
    // happened, instead of thanking them for a purchase they made months ago.
    kind?: WelcomeKind;
    // The buyer's name as the store has it, so support can find them by it.
    name?: string;
    // Send the welcome again to someone who already holds the course. The
    // normal guard exists so a rerun of a batch cannot spam buyers, but a
    // student who lost their link — or was granted access without ever being
    // told — needs a way to be sent one.
    resend?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  // Addressed by BigCommerce product id rather than our internal course id:
  // whoever is working from an order screen has the product in front of them,
  // and a course id would have to be looked up and could be mistyped into a
  // silently wrong — but still valid — course.
  const { data: course } = await admin
    .from("courses")
    .select("id, title")
    .eq("bigcommerce_product_id", body.productId ?? -1)
    .maybeSingle();

  if (!course) {
    return NextResponse.json(
      { error: `no course is mapped to product ${body.productId}` },
      { status: 404 }
    );
  }

  // Find or create the buyer's account.
  let userId = await findUserId(admin, email);
  let created = false;
  if (!userId) {
    const buyerName = (body.name ?? "").trim() || null;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true, // they paid; don't make them confirm as well
      ...(buyerName ? { user_metadata: { full_name: buyerName } } : {}),
    });
    if (error || !data.user) {
      return NextResponse.json(
        { error: `could not create account: ${error?.message ?? "unknown"}` },
        { status: 500 }
      );
    }
    userId = data.user.id;
    created = true;
  } else {
    await rememberStudentName(userId, (body.name ?? "").trim() || null);
  }

  // Don't mail someone a second welcome for a course they already have — a
  // rerun of a batch would otherwise spam every buyer in it.
  const { data: existing } = await admin
    .from("purchases")
    .select("course_id")
    .eq("user_id", userId)
    .eq("course_id", course.id)
    .maybeSingle();

  if (existing && !body.resend) {
    return NextResponse.json({
      ok: true,
      created,
      alreadyHadCourse: true,
      emailed: false,
      course: course.title,
    });
  }

  // Asked to send again for a course they already have: nothing to grant, so
  // mail and report without touching their access.
  //
  // A resend lists everything they hold, not just the course named in the
  // call. Nothing is being granted here, so naming one of four would tell
  // someone less than they already have — and the admin page's own resend
  // button has always listed the lot.
  if (existing && body.resend) {
    const { data: owned } = await admin
      .from("purchases")
      .select("course:courses(title)")
      .eq("user_id", userId);
    const allTitles = (owned ?? [])
      .map((p) => (p.course as unknown as { title: string } | null)?.title)
      .filter((t): t is string => Boolean(t));

    const where = await emailOriginOrReason(req.headers, "a resent welcome");
    const resent = where.origin
      ? await sendCourseWelcome({
          to: email,
          courseTitles: allTitles.length > 0 ? allTitles : [course.title],
          origin: where.origin,
          locale: localeForProduct(body.productId),
          kind: body.kind,
          userId,
        })
      : { sent: false as const, reason: where.reason };
    return NextResponse.json({
      ok: true,
      created: false,
      alreadyHadCourse: true,
      resent: true,
      course: course.title,
      emailed: resent.sent,
      ...(resent.reason ? { emailError: resent.reason } : {}),
    });
  }

  const { error: grantError } = await admin.from("purchases").upsert(
    // 0 marks access given by hand rather than by a BigCommerce order, so the
    // two stay tellable apart later.
    { user_id: userId, course_id: course.id, bigcommerce_order_id: 0 },
    { onConflict: "user_id,course_id" }
  );
  if (grantError) {
    return NextResponse.json(
      { error: `could not grant access: ${grantError.message}` },
      { status: 500 }
    );
  }

  // The grant above has already landed, so a missing setting must not turn
  // into a 500 here: that would leave a student enrolled, the caller holding
  // an error, and nobody told. Report it as access given and not emailed —
  // which is exactly what happened, and what the admin screens already show.
  const where =
    body.notify === false
      ? { reason: "notify disabled by caller" as const, origin: undefined }
      : await emailOriginOrReason(req.headers, "an onboarding welcome");

  const mail = where.origin
    ? await sendCourseWelcome({
        to: email,
        courseTitles: [course.title],
        origin: where.origin,
        locale: localeForProduct(body.productId),
        kind: body.kind,
        userId,
      })
    : { sent: false as const, reason: where.reason };

  return NextResponse.json({
    ok: true,
    created,
    alreadyHadCourse: false,
    course: course.title,
    emailed: mail.sent,
    ...(mail.reason ? { emailError: mail.reason } : {}),
  });
}

// listUsers() is paginated and defaults to the first 50 accounts, so page one
// alone would start missing returning customers as the school grows.
async function findUserId(
  admin: ReturnType<typeof supabaseAdmin>,
  email: string
): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`could not list users: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}
