import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { PasswordForm } from "./password-form";
import { RECOVERY_COOKIE } from "@/lib/recovery-grant";

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Reached either from a recovery link (already a session by this point) or
  // from the dashboard while signed in. Anyone else gets sent to sign in.
  if (!user) redirect("/login");

  const hasPassword = Boolean(user.user_metadata?.has_password);
  // A reset link is itself the proof of ownership, so don't also demand the
  // password they just told us they'd forgotten.
  const fromRecovery = (await cookies()).get(RECOVERY_COOKIE)?.value === "1";

  return (
    <PasswordForm
      email={user.email ?? ""}
      hasPassword={hasPassword}
      fromRecovery={fromRecovery}
    />
  );
}
