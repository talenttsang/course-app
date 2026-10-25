"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { currentAdmin } from "@/lib/admin";
import { onboardOrder, type OrderOnboardResult } from "@/lib/order-onboarding";

// One click on the Waiting page. Only the store and order id come from the
// browser; who the buyer is and what they bought are read back from
// BigCommerce, so a tampered request can at most onboard a real paid order.
export async function onboardWaitingOrder(input: {
  store: string;
  order: number;
}): Promise<OrderOnboardResult> {
  const session = await currentAdmin();
  if (!session) return { ok: false, error: "Not authorised." };

  if (!/^[A-Za-z0-9]+$/.test(input.store) || !Number.isInteger(input.order) || input.order <= 0) {
    return { ok: false, error: "That is not a valid order." };
  }

  try {
    const result = await onboardOrder({
      storeHash: input.store,
      orderId: input.order,
      headers: await headers(),
    });
    revalidatePath("/admin/students");
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
