"use server";

import { cookies } from "next/headers";
import { RECOVERY_COOKIE } from "@/lib/recovery-grant";

// Burn the recovery marker as soon as it has been used, so one reset link
// grants exactly one password change rather than fifteen minutes of them.
export async function clearRecoveryGrant() {
  (await cookies()).set({ name: RECOVERY_COOKIE, value: "", path: "/", maxAge: 0 });
}
