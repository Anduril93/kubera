"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import { parseAmountInput } from "@/lib/money";
import {
  accountCreateSchema,
  accountUpdateSchema,
  type AccountFormState,
} from "@/lib/validations/account";

const idSchema = z.string().uuid();

function balanceToCents(raw: string | undefined): number | null {
  if (!raw || raw.trim() === "") return null;
  // Liabilities/overdrafts can be negative, so allow it.
  return parseAmountInput(raw, { allowNegative: true });
}

/** Create a manual account in the caller's household. */
export async function createAccount(
  _prev: AccountFormState,
  formData: FormData
): Promise<AccountFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = accountCreateSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    institution: formData.get("institution") ?? undefined,
    currency: formData.get("currency") ?? undefined,
    starting_balance: formData.get("starting_balance") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let cents = 0;
  try {
    cents = balanceToCents(parsed.data.starting_balance) ?? 0;
  } catch {
    return { error: "Enter a valid starting balance" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("accounts").insert({
    household_id: household.id,
    name: parsed.data.name,
    type: parsed.data.type,
    institution: parsed.data.institution,
    current_balance_cents: cents,
    currency: parsed.data.currency,
    is_manual: true,
  });
  if (error) {
    console.error("[accounts] create failed", error);
    return { error: "Could not create the account." };
  }

  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { success: true };
}

/** Update an account in the caller's household. */
export async function updateAccount(
  _prev: AccountFormState,
  formData: FormData
): Promise<AccountFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = accountUpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    type: formData.get("type"),
    institution: formData.get("institution") ?? undefined,
    currency: formData.get("currency") ?? undefined,
    balance: formData.get("balance") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const patch: Record<string, unknown> = {
    name: parsed.data.name,
    type: parsed.data.type,
    institution: parsed.data.institution,
    currency: parsed.data.currency,
  };
  try {
    const cents = balanceToCents(parsed.data.balance);
    if (cents !== null) patch.current_balance_cents = cents;
  } catch {
    return { error: "Enter a valid balance" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("household_id", household.id) // defense in depth; RLS also enforces
    .select("id");
  if (error) {
    console.error("[accounts] update failed", error);
    return { error: "Could not update the account." };
  }
  if (!data || data.length === 0) return { error: "Account not found." };

  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { success: true };
}

/** Archive (soft-delete) an account in the caller's household. */
export async function archiveAccount(
  _prev: AccountFormState,
  formData: FormData
): Promise<AccountFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) return { error: "Invalid account" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .update({ is_archived: true })
    .eq("id", parsedId.data)
    .eq("household_id", household.id)
    .select("id");
  if (error) {
    console.error("[accounts] archive failed", error);
    return { error: "Could not archive the account." };
  }
  if (!data || data.length === 0) return { error: "Account not found." };

  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { success: true };
}
