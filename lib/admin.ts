import { supabaseServer, supabaseAdmin } from "./supabase-server";
import type { User } from "@supabase/supabase-js";

// Staff access has two layers.
//
// OWNERS come from the ADMIN_EMAILS env var on the Cloud Run service. They
// can't be removed through the UI, which is what makes it impossible to
// lock everyone out of the admin area by mistake — there is always a way
// back in through configuration.
//
// ADMINS live in the `admins` table and are managed by staff themselves,
// so adding a colleague no longer needs a developer or a deploy.
//
// Both fail CLOSED: with no env var and an empty table nobody is an admin.

export function ownerEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerEmail(email?: string | null) {
  if (!email) return false;
  return ownerEmails().includes(email.toLowerCase());
}

// The `admins` table has RLS on with no policies, so only the service-role
// client can see it — the staff list is never exposed to the browser.
export async function isAdmin(email?: string | null): Promise<boolean> {
  if (!email) return false;
  if (isOwnerEmail(email)) return true;

  const { data } = await supabaseAdmin()
    .from("admins")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  return Boolean(data);
}

export type AdminSession = { user: User; isOwner: boolean };

// The signed-in admin, or null. Every server action calls this again before
// writing — what the page decided to render is never the authority.
export async function currentAdmin(): Promise<AdminSession | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAdmin(user.email))) return null;
  return { user, isOwner: isOwnerEmail(user.email) };
}

// Whether staff access has been configured at all, for the "not set up yet"
// message on the locked-out page.
export async function accessConfigured() {
  if (ownerEmails().length > 0) return true;
  const { count } = await supabaseAdmin()
    .from("admins")
    .select("id", { count: "exact", head: true });
  return (count ?? 0) > 0;
}

export type StaffMember = { email: string; addedBy: string | null; permanent: boolean };

// The full staff list: permanent owners from configuration first, then
// everyone added through the admin page.
export async function listStaff(): Promise<StaffMember[]> {
  const owners = ownerEmails();
  const { data } = await supabaseAdmin()
    .from("admins")
    .select("email, added_by, created_at")
    .order("created_at", { ascending: true });

  return [
    ...owners.map((email) => ({ email, addedBy: null, permanent: true })),
    ...(data ?? [])
      .filter((a) => !owners.includes(a.email))
      .map((a) => ({ email: a.email, addedBy: a.added_by as string | null, permanent: false })),
  ];
}

// "Not an admin" covers two different people: a colleague who simply has not
// signed in yet, and someone signed in who is not staff. Sending the first to
// a dead end costs them the page they were trying to open; sending the second
// to a login form they have already completed is a loop. The gate has to tell
// them apart.
export type AdminGate =
  | { status: "anonymous" }
  | { status: "not-staff"; email: string | null }
  | { status: "ok"; session: AdminSession };

export async function adminGate(): Promise<AdminGate> {
  const {
    data: { user },
  } = await (await supabaseServer()).auth.getUser();
  if (!user) return { status: "anonymous" };
  if (!(await isAdmin(user.email))) return { status: "not-staff", email: user.email ?? null };
  return { status: "ok", session: { user, isOwner: isOwnerEmail(user.email) } };
}
