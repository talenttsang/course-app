import Link from "next/link";
import { redirect } from "next/navigation";
import { adminGate, accessConfigured, type AdminSession } from "@/lib/admin";
import { TopNav } from "./components";

// Opening an admin page while signed out now takes you to a sign-in that
// returns you here afterwards. Before this, every staff page dead-ended on a
// message, its link dropped where you were headed, and signing in landed you
// on the student dashboard — which, now that staff hold every course, is
// indistinguishable from the admin area having no login of its own.
export async function requireStaff(
  returnTo: string
): Promise<{ session: AdminSession; denied?: undefined } | { denied: JSX.Element; session?: undefined }> {
  const gate = await adminGate();

  if (gate.status === "anonymous") {
    // Nothing to explain to someone who simply has not signed in yet; send
    // them to the sign-in carrying where they were going.
    if (await accessConfigured()) {
      redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    return { denied: <NotConfigured /> };
  }

  // Signed in, but not staff. A login form they have already completed would
  // just loop, so say what is actually wrong.
  if (gate.status === "not-staff") {
    return { denied: <NotStaff email={gate.email} /> };
  }

  return { session: gate.session };
}

function NotStaff({ email }: { email: string | null }) {
  return (
    <div>
      <TopNav label="COURSE ADMIN" email={email ?? undefined} />
      <div className="page-wrap" style={{ maxWidth: 640 }}>
        <div className="empty-state">
          <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--ink)" }}>
            This area is for Superhairpieces staff
          </p>
          <p style={{ margin: "0 0 4px", fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
            You are signed in as {email ?? "this account"}, which does not have
            staff access. Ask a colleague who does to add you.
          </p>
          <div style={{ marginTop: 18 }}>
            <Link href="/dashboard" className="btn">Go to my courses</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// With no owner configured and an empty staff table nobody is an admin, so
// sending anyone to sign in would be a loop they cannot win.
function NotConfigured() {
  return (
    <div>
      <TopNav label="COURSE ADMIN" />
      <div className="page-wrap" style={{ maxWidth: 640 }}>
        <div className="empty-state">
          <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--ink)" }}>
            This area is for Superhairpieces staff
          </p>
          Staff access hasn&apos;t been configured on this deployment yet.
        </div>
      </div>
    </div>
  );
}
