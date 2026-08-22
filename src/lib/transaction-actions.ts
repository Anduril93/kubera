"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import { parseAmountInput } from "@/lib/money";
import {
  transactionSchema,
  transactionUpdateSchema,
  splitInputSchema,
  type TransactionFormState,
} from "@/lib/validations/transaction";

const idSchema = z.string().uuid();

function revalidateLedger() {
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
}

/** Create a manual transaction and apply its balance delta atomically (RPC). */
export async function createTransaction(
  _prev: TransactionFormState,
  formData: FormData
): Promise<TransactionFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = transactionSchema.safeParse({
    account_id: formData.get("account_id"),
    category_id: formData.get("category_id") ?? undefined,
    type: formData.get("type"),
    amount: formData.get("amount"),
    date: formData.get("date"),
    merchant: formData.get("merchant") ?? undefined,
    description: formData.get("description") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    pending: formData.get("pending") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let amountCents: number;
  try {
    amountCents = parseAmountInput(parsed.data.amount);
  } catch {
    return { error: "Enter a valid amount" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_transaction", {
    p_account_id: parsed.data.account_id,
    p_type: parsed.data.type,
    p_amount_cents: amountCents,
    p_date: parsed.data.date,
    p_category_id: parsed.data.category_id,
    p_merchant: parsed.data.merchant,
    p_description: parsed.data.description,
    p_notes: parsed.data.notes,
    p_pending: parsed.data.pending ?? false,
    p_source: "manual",
  });
  if (error) {
    console.error("[transactions] create failed", error);
    return { error: "Could not create the transaction." };
  }

  revalidateLedger();
  return { success: true };
}

/** Update a transaction; the RPC reverses the old balance delta and applies the new. */
export async function updateTransaction(
  _prev: TransactionFormState,
  formData: FormData
): Promise<TransactionFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = transactionUpdateSchema.safeParse({
    id: formData.get("id"),
    account_id: formData.get("account_id"),
    category_id: formData.get("category_id") ?? undefined,
    type: formData.get("type"),
    amount: formData.get("amount"),
    date: formData.get("date"),
    merchant: formData.get("merchant") ?? undefined,
    description: formData.get("description") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    pending: formData.get("pending") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let amountCents: number;
  try {
    amountCents = parseAmountInput(parsed.data.amount);
  } catch {
    return { error: "Enter a valid amount" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_transaction", {
    p_id: parsed.data.id,
    p_account_id: parsed.data.account_id,
    p_type: parsed.data.type,
    p_amount_cents: amountCents,
    p_date: parsed.data.date,
    p_category_id: parsed.data.category_id,
    p_merchant: parsed.data.merchant,
    p_description: parsed.data.description,
    p_notes: parsed.data.notes,
    p_pending: parsed.data.pending ?? false,
  });
  if (error) {
    console.error("[transactions] update failed", error);
    return { error: "Could not update the transaction." };
  }

  revalidateLedger();
  return { success: true };
}

/** Delete a transaction; the RPC reverses its balance delta (children cascade). */
export async function deleteTransaction(
  _prev: TransactionFormState,
  formData: FormData
): Promise<TransactionFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) return { error: "Invalid transaction" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_transaction", {
    p_id: parsedId.data,
  });
  if (error) {
    console.error("[transactions] delete failed", error);
    return { error: "Could not delete the transaction." };
  }

  revalidateLedger();
  return { success: true };
}

const splitFormChild = z.object({
  category_id: z.string().uuid().nullable().optional(),
  amount: z.string(),
  description: z.string().max(200).nullable().optional(),
});

/**
 * Split a transaction into child parts that must sum exactly to the parent.
 * The `children` form field is a JSON array of { category_id?, amount, description? }.
 */
export async function splitTransaction(
  _prev: TransactionFormState,
  formData: FormData
): Promise<TransactionFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsedId = idSchema.safeParse(formData.get("transaction_id"));
  if (!parsedId.success) return { error: "Invalid transaction" };

  // Parse the children JSON payload and convert dollar amounts to cents.
  let rawChildren: unknown;
  try {
    rawChildren = JSON.parse(String(formData.get("children") ?? "[]"));
  } catch {
    return { error: "Invalid split data" };
  }
  const childrenParse = z.array(splitFormChild).safeParse(rawChildren);
  if (!childrenParse.success) {
    return { error: "Invalid split parts" };
  }

  let childrenCents: { category_id: string | null; amount_cents: number; description: string | null }[];
  try {
    childrenCents = childrenParse.data.map((c) => ({
      category_id: c.category_id ?? null,
      amount_cents: parseAmountInput(c.amount),
      description: c.description ?? null,
    }));
  } catch {
    return { error: "Enter valid amounts for each part" };
  }

  // Authoritative parent amount from the ledger (RLS-scoped).
  const supabase = await createClient();
  const { data: parent, error: parentErr } = await supabase
    .from("transactions")
    .select("amount_cents")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (parentErr || !parent) {
    return { error: "Transaction not found" };
  }

  // Enforce the exact-sum rule in the schema before hitting the RPC.
  const validated = splitInputSchema.safeParse({
    parent_amount_cents: parent.amount_cents as number,
    children: childrenCents,
  });
  if (!validated.success) {
    return { error: validated.error.issues[0]?.message ?? "Invalid split" };
  }

  const { error } = await supabase.rpc("split_transaction", {
    p_parent_id: parsedId.data,
    p_children: childrenCents,
  });
  if (error) {
    console.error("[transactions] split failed", error);
    return { error: "Could not split the transaction." };
  }

  revalidateLedger();
  return { success: true };
}
