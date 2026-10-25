import Link from "next/link";
import { requireStaff } from "../../staff-gate";
import { TopNav } from "../../components";
import { supabaseAdmin } from "@/lib/supabase-server";
import { listStudents } from "@/lib/students";
import { smtpConfigured } from "@/lib/email";
import { storeTokens, CATALOGUE_STORE, catalogueStoreIsConfigured } from "@/lib/bigcommerce";
import { reconcile, DEFAULT_DAYS, MAX_DAYS, type Reconciliation } from "@/lib/reconcile";
import { WaitingTable } from "./waiting-table";

export const dynamic = "force-dynamic";
// A ten-day scan reads every paid order's line items on every store.
export const maxDuration = 900;

// Where staff find everyone who needs attention. There is no order webhook
// and no team chat: a sale only becomes a student when someone onboards it
// here, so this page has to say, without being asked, who has paid and is
// waiting, who was given access but never told, and which settings would
// make either of those silently worse.
export default async function WaitingPage(props: {
  searchParams: Promise<{ days?: string; store?: string; run?: string }>;
}) {
  const gate = await requireStaff("/admin/waiting");
  if (gate.denied) return gate.denied;
  const session = gate.session;
  const searchParams = await props.searchParams;

  const days = Number(searchParams.days) || DEFAULT_DAYS;
  const store = searchParams.store || null;
  const stores = Object.keys(storeTokens());

  const problems = setupProblems(stores);

  const students = await listStudents();
  const notTold = students.filter((s) => s.courses.length > 0 && s.welcomeError);

  const db = supabaseAdmin();
  const { data: courses } = await db.from("courses").select("title, bigcommerce_product_id");
  const courseTitles: Record<number, string> = {};
  for (const c of courses ?? []) courseTitles[c.bigcommerce_product_id] = c.title;

  // The scan costs a request per paid order, so it runs when asked rather
  // than on every visit.
  let result: Reconciliation | null = null;
  let scanError = "";
  if (searchParams.run) {
    try {
      result = await reconcile({ days, store });
    } catch (err) {
      scanError = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <div>
      <TopNav label="COURSE ADMIN" email={session.user.email ?? undefined} />
      <div className="page-wrap">
        <Link href="/admin" className="link" style={{ fontSize: 13 }}>
          ← Courses
        </Link>
        <p className="page-eyebrow" style={{ marginTop: 18 }}>Evolve Academy</p>
        <h1 className="page-title">Waiting</h1>
        <p className="page-sub">
          Course sales are not onboarded automatically. Check for paid orders here and
          onboard each buyer — they get an account, the course and a welcome email.
        </p>

        {problems.length > 0 && (
          <>
            <div className="admin-section-head">
              <h2>Setup problems</h2>
              <span>{problems.length}</span>
            </div>
            <div className="admin-card" style={{ marginBottom: 44 }}>
              {problems.map((p) => (
                <p key={p} className="auth-error" style={{ margin: "0 0 8px" }}>
                  {p}
                </p>
              ))}
            </div>
          </>
        )}

        <div className="admin-section-head">
          <h2>Paid, no access</h2>
          <span>
            {result
              ? `${result.missing.length} waiting · ${result.ordersScanned} orders scanned · last ${result.days} days`
              : "not checked yet"}
          </span>
        </div>

        <form method="get" className="admin-card" style={{ marginBottom: 20, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="run" value="1" />
          <label>
            <span className="field-label">Days back</span>
            <input
              className="field-input"
              type="number"
              name="days"
              min={1}
              max={MAX_DAYS}
              defaultValue={days}
              style={{ width: 110 }}
            />
          </label>
          <label>
            <span className="field-label">Store</span>
            <select className="field-input" name="store" defaultValue={store ?? ""}>
              <option value="">All stores</option>
              {stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            Check now
          </button>
          <p className="admin-hint" style={{ flexBasis: "100%" }}>
            Reads every paid order in the window from BigCommerce. Ten days on all stores
            can take a few minutes.
          </p>
        </form>

        {scanError && <p className="auth-error">Could not run the check: {scanError}</p>}

        {result && (
          <>
            {result.storeErrors.length > 0 && (
              <p className="auth-error">
                Could not fully check {result.storeErrors.join("; ")}. Buyers on those stores
                may be missing from this list.
              </p>
            )}

            {result.missing.length === 0 ? (
              <div className="empty-state" style={{ marginBottom: 44 }}>
                Every course buyer in the last {result.days} days has their course.
              </div>
            ) : (
              <WaitingTable missing={result.missing} courseTitles={courseTitles} />
            )}

            {result.unmatched.length > 0 && (
              <>
                <div className="admin-section-head">
                  <h2>Could not match</h2>
                  <span>{result.unmatched.length}</span>
                </div>
                <p className="admin-hint" style={{ margin: "-8px 0 16px" }}>
                  These lines look like a course but carry a SKU we do not know. Either it is an
                  ordinary product that shares an id with a course — nothing to do — or a course
                  whose SKU changed, in which case the buyer has no access and the SKU map in
                  lib/bigcommerce.ts needs updating.
                </p>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Product</th>
                      <th>SKU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.unmatched.map((u, i) => (
                      <tr key={`${u.store}:${u.order}:${i}`}>
                        <td>
                          #{u.order} <span style={{ color: "var(--muted)" }}>· {u.store}</span>
                        </td>
                        <td>
                          {u.name ?? "unnamed"}{" "}
                          <span style={{ color: "var(--muted)" }}>· {u.productId ?? "?"}</span>
                        </td>
                        <td>{u.sku ?? "none"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}

        <div className="admin-section-head">
          <h2>Access but not told</h2>
          <span>{notTold.length}</span>
        </div>
        {notTold.length === 0 ? (
          <div className="empty-state">Every student with a course was sent their welcome.</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Why the welcome failed</th>
              </tr>
            </thead>
            <tbody>
              {notTold.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/admin/students/${s.id}`} className="link">
                      {s.email}
                    </Link>
                    {s.name && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{s.name}</div>}
                  </td>
                  <td style={{ color: "var(--muted)" }}>{s.welcomeError}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Settings that are wrong in a way that stops real work. The site keeps
// serving either way, so nothing else would ever say so.
function setupProblems(stores: string[]): string[] {
  const out: string[] = [];
  if (stores.length === 0) {
    out.push("No BigCommerce store tokens are set (BIGCOMMERCE_STORES), so no orders can be checked.");
  } else if (!catalogueStoreIsConfigured()) {
    out.push(
      `BIGCOMMERCE_STORES has no token for ${CATALOGUE_STORE} (.ca), the store the courses table's product ids come from, so courses can only be matched by SKU.`
    );
  }
  if (!smtpConfigured()) {
    out.push("SMTP is not configured (SMTP_HOST / SMTP_PASS), so no welcome email can be sent.");
  }
  if (process.env.NODE_ENV === "production" && !(process.env.PUBLIC_ORIGIN ?? "").trim()) {
    out.push("PUBLIC_ORIGIN is not set, so welcome emails cannot carry a sign-in link and are not sent.");
  }
  return out;
}
