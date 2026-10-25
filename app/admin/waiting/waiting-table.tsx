"use client";

import { useState, useTransition } from "react";
import { onboardWaitingOrder } from "./actions";
import type { MissingBuyer } from "@/lib/reconcile";

type RowState = { done?: boolean; message: string; error?: boolean };

export function WaitingTable({
  missing,
  courseTitles,
}: {
  missing: MissingBuyer[];
  courseTitles: Record<number, string>;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  function onboard(m: MissingBuyer) {
    const key = `${m.store}:${m.order}`;
    setBusy(key);
    start(async () => {
      const result = await onboardWaitingOrder({ store: m.store, order: m.order });
      let state: RowState;
      if (!result.ok) {
        state = { message: result.error, error: true };
      } else if ("skipped" in result) {
        state = { done: true, message: `Nothing to do: ${result.skipped}.` };
      } else {
        // Say plainly whether the buyer was actually told. "Access granted"
        // on its own would leave staff assuming an email went out when the
        // mail server was down, and nobody would follow up.
        state = result.emailed
          ? { done: true, message: `Onboarded and emailed (${result.coursesGranted.join(", ")}).` }
          : {
              done: true,
              error: true,
              message: `Access granted but the welcome email was NOT sent${
                result.emailError ? ` (${result.emailError})` : ""
              }. Resend it from their student page or contact them.`,
            };
      }
      setRows((r) => ({ ...r, [key]: state }));
      setBusy(null);
    });
  }

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Buyer</th>
          <th>Course</th>
          <th>Order</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {missing.map((m) => {
          const key = `${m.store}:${m.order}`;
          const state = rows[key];
          return (
            <tr key={`${key}:${m.productId}`}>
              <td>
                <div style={{ fontWeight: 600, color: "var(--ink)" }}>{m.email || "no email on order"}</div>
                {m.name && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{m.name}</div>}
              </td>
              <td>{courseTitles[m.productId] ?? `product ${m.productId}`}</td>
              <td>
                <div>#{m.order}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {m.store} · {m.date ? new Date(m.date).toLocaleDateString() : "no date"}
                </div>
              </td>
              <td style={{ maxWidth: 320 }}>
                {state?.done ? null : (
                  <button
                    className="btn-ghost admin-sm"
                    onClick={() => onboard(m)}
                    disabled={pending || !m.email}
                  >
                    {busy === key ? "Onboarding…" : "Onboard"}
                  </button>
                )}
                {state && (
                  <p
                    className={state.error ? "auth-error" : "admin-notice"}
                    style={{ margin: state.done ? 0 : "8px 0 0" }}
                  >
                    {state.message}
                  </p>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
