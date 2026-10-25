import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { TopNav } from "../components";

export default async function Dashboard() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: purchases } = await supabase
    .from("purchases")
    .select("course:courses(slug, title, description)")
    .eq("user_id", user.id);

  const courses = purchases?.map((p: any) => p.course).filter(Boolean) ?? [];
  const showAdminLink = await isAdmin(user.email);
  // Accounts are created by a purchase, so most students arrive without a
  // password and would otherwise wait on an email every single visit.
  const needsPassword = !user.user_metadata?.has_password;

  return (
    <div>
      <TopNav label="MY DASHBOARD" email={user.email ?? undefined} />
      <div className="page-wrap">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <p className="page-eyebrow">Evolve Academy</p>
            <h1 className="page-title">My courses</h1>
            <p className="page-sub">
              Welcome back. Pick up where you left off.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {showAdminLink && (
              <Link href="/admin" className="btn-ghost">
                Manage courses
              </Link>
            )}
          </div>
        </div>

        {needsPassword && (
          <div className="notice-bar">
            <div>
              <strong>Set a password</strong> so you can sign in straight away next
              time, instead of waiting for an email link.
            </div>
            <Link href="/account/password" className="btn admin-sm">
              Set a password
            </Link>
          </div>
        )}

        {courses.length === 0 ? (
          <div className="empty-state">
            <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--ink)" }}>
              No courses on this account yet
            </p>
            Just purchased one? Access is granted automatically and usually appears
            within a few minutes. Make sure you signed in with the same email you used
            at checkout — or contact{" "}
            <a href="mailto:support@superhairpieces.com" className="link">
              support@superhairpieces.com
            </a>
            .
          </div>
        ) : (
          <div className="course-grid">
            {courses.map((c: any) => (
              <div key={c.slug} className="course-card">
                <div className="course-card-cover">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/shp-logo.svg" alt="" />
                </div>
                <div className="course-card-body">
                  <h3>{c.title}</h3>
                  <Link href={`/course/${c.slug}`} className="btn" style={{ alignSelf: "flex-start" }}>
                    Continue course
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
