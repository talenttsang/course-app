import { supabaseAdmin } from "./supabase-server";

export type Student = {
  id: string;
  name: string | null;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  hasPassword: boolean;
  welcomeSentAt: string | null;
  welcomeError: string | null;
  courses: { id: string; title: string; slug: string; orderId: number | null }[];
};

// Auth accounts live in Supabase's auth schema and purchases in ours, so a
// student is assembled from both. listUsers is paginated; we walk it rather
// than reading page one, which would quietly hide everyone past the first
// 200 once the school grows.
const PER_PAGE = 200;
const MAX_PAGES = 25; // 5,000 students; far beyond current scale

export async function listStudents(): Promise<Student[]> {
  const admin = supabaseAdmin();

  const users = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(`could not list students: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < PER_PAGE) break;
  }

  const { data: purchases } = await admin
    .from("purchases")
    .select("user_id, bigcommerce_order_id, course:courses(id, title, slug)");

  const byUser = new Map<string, Student["courses"]>();
  for (const p of purchases ?? []) {
    const course = p.course as any;
    if (!course) continue;
    const list = byUser.get(p.user_id) ?? [];
    list.push({
      id: course.id,
      title: course.title,
      slug: course.slug,
      orderId: p.bigcommerce_order_id ?? null,
    });
    byUser.set(p.user_id, list);
  }

  return users
    .map((u) => ({
      id: u.id,
      name: nameOf(u.user_metadata),
      email: u.email ?? "(no email)",
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      hasPassword: Boolean(u.user_metadata?.has_password),
      welcomeSentAt: strOf(u.user_metadata?.welcome_sent_at),
      welcomeError: strOf(u.user_metadata?.welcome_error),
      courses: byUser.get(u.id) ?? [],
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getStudent(id: string): Promise<Student | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data.user) return null;

  const { data: purchases } = await admin
    .from("purchases")
    .select("bigcommerce_order_id, course:courses(id, title, slug)")
    .eq("user_id", id);

  return {
    id: data.user.id,
    name: nameOf(data.user.user_metadata),
    email: data.user.email ?? "(no email)",
    createdAt: data.user.created_at,
    lastSignInAt: data.user.last_sign_in_at ?? null,
    hasPassword: Boolean(data.user.user_metadata?.has_password),
    welcomeSentAt: strOf(data.user.user_metadata?.welcome_sent_at),
    welcomeError: strOf(data.user.user_metadata?.welcome_error),
    courses: (purchases ?? [])
      .map((p) => {
        const course = p.course as any;
        return course
          ? {
              id: course.id,
              title: course.title,
              slug: course.slug,
              orderId: p.bigcommerce_order_id ?? null,
            }
          : null;
      })
      .filter(Boolean) as Student["courses"],
  };
}

function strOf(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function nameOf(meta: Record<string, unknown> | undefined): string | null {
  const v = meta?.full_name;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// The buyer's name as the store recorded it. Without this a student is only
// ever an email address, so support cannot find "Jen" unless they already
// know she is jmeyerhairstudio@ — which is usually the thing they are trying
// to look up.
export function fullNameFromBilling(billing: unknown): string | null {
  if (!billing || typeof billing !== "object") return null;
  const b = billing as Record<string, unknown>;
  const name = [b.first_name, b.last_name]
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join(" ")
    .trim();
  return name || null;
}

// Records a name without ever overwriting one already there: a later order
// under a slightly different spelling should not churn the record, and an
// empty value must never blank out a good one.
export async function rememberStudentName(userId: string, name: string | null) {
  if (!name) return;
  const admin = supabaseAdmin();
  const { data } = await admin.auth.admin.getUserById(userId);
  if (!data.user || nameOf(data.user.user_metadata)) return;
  await admin.auth.admin.updateUserById(userId, {
    user_metadata: { ...(data.user.user_metadata ?? {}), full_name: name },
  });
}
