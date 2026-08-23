"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import { getSignedR2Url, R2NotConfiguredError } from "@/lib/r2";

const idSchema = z.string().uuid();

/**
 * Returns a short-lived signed URL for a transaction's receipt. Scoped to
 * household members: the transaction is read under RLS, and the stored key must
 * be in this household's namespace. There is no public bucket URL.
 */
export async function getReceiptUrl(
  transactionId: string
): Promise<{ url?: string; error?: string }> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "Not signed in." };

  const parsed = idSchema.safeParse(transactionId);
  if (!parsed.success) return { error: "Invalid transaction." };

  const supabase = await createClient();
  const { data } = await supabase
    .from("transactions")
    .select("receipt_url")
    .eq("id", parsed.data)
    .maybeSingle();

  const key = data?.receipt_url as string | null | undefined;
  if (!key) return { error: "No receipt attached." };
  if (!key.startsWith(`receipts/${household.id}/`)) {
    return { error: "Receipt not available." };
  }

  try {
    const url = await getSignedR2Url(key, 300);
    return { url };
  } catch (err) {
    if (err instanceof R2NotConfiguredError) {
      return { error: "Receipts aren't available right now." };
    }
    console.error("[receipt] sign failed", err);
    return { error: "Couldn't open the receipt." };
  }
}
