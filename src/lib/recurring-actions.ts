"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import { parseAmountInput } from "@/lib/money";
import {
  recurringCreateSchema,
  recurringUpdateSchema,
  type RecurringFormState,
} from "@/lib/validations/recurring";

const idSchema = z.string().uuid();

function revalidateRecurring() {
  revalidatePath("/bills");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** The account must belong to the household (RLS returns only visible ones). */
async function accountIsVisible(supabase: ServerClient, id: string) {
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  return !!data;
}

/** A category must be visible (system default or the household's own). */
async function categoryIsVisible(supabase: ServerClient, id: string) {
  const { data } = await supabase
    .from("categories")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  return !!data;
}

export async function createRecurringRule(
  _prev: RecurringFormState,
  formData: FormData
): Promise<RecurringFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = recurringCreateSchema.safeParse({
    account_id: formData.get("account_id"),
    category_id: formData.get("category_id") ?? undefined,
    name: formData.get("name"),
    amount: formData.get("amount"),
    type: formData.get("type"),
    frequency: formData.get("frequency"),
    next_due_date: formData.get("next_due_date"),
    end_date: formData.get("end_date") ?? undefined,
    auto_post: formData.get("auto_post") === "true",
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
  if (!(await accountIsVisible(supabase, parsed.data.account_id))) {
    return { error: "That account isn't available." };
  }
  if (
    parsed.data.category_id &&
    !(await categoryIsVisible(supabase, parsed.data.category_id))
  ) {
    return { error: "That category isn't available." };
  }

  const { error } = await supabase.from("recurring_rules").insert({
    household_id: household.id,
    account_id: parsed.data.account_id,
    category_id: parsed.data.category_id,
    name: parsed.data.name,
    amount_cents: amountCents,
    type: parsed.data.type,
    frequency: parsed.data.frequency,
    next_due_date: parsed.data.next_due_date,
    end_date: parsed.data.end_date,
    auto_post: parsed.data.auto_post ?? false,
  });
  if (error) {
    console.error("[recurring] create failed", error);
    return { error: "Could not create the recurring rule." };
  }

  revalidateRecurring();
  return { success: true };
}

export async function updateRecurringRule(
  _prev: RecurringFormState,
  formData: FormData
): Promise<RecurringFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = recurringUpdateSchema.safeParse({
    id: formData.get("id"),
    account_id: formData.get("account_id"),
    category_id: formData.get("category_id") ?? undefined,
    name: formData.get("name"),
    amount: formData.get("amount"),
    type: formData.get("type"),
    frequency: formData.get("frequency"),
    next_due_date: formData.get("next_due_date"),
    end_date: formData.get("end_date") ?? undefined,
    auto_post: formData.get("auto_post") === "true",
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
  if (!(await accountIsVisible(supabase, parsed.data.account_id))) {
    return { error: "That account isn't available." };
  }
  if (
    parsed.data.category_id &&
    !(await categoryIsVisible(supabase, parsed.data.category_id))
  ) {
    return { error: "That category isn't available." };
  }

  const { data, error } = await supabase
    .from("recurring_rules")
    .update({
      account_id: parsed.data.account_id,
      category_id: parsed.data.category_id,
      name: parsed.data.name,
      amount_cents: amountCents,
      type: parsed.data.type,
      frequency: parsed.data.frequency,
      next_due_date: parsed.data.next_due_date,
      end_date: parsed.data.end_date,
      auto_post: parsed.data.auto_post ?? false,
    })
    .eq("id", parsed.data.id)
    .eq("household_id", household.id)
    .select("id");
  if (error) {
    console.error("[recurring] update failed", error);
    return { error: "Could not update the recurring rule." };
  }
  if (!data || data.length === 0) return { error: "Recurring rule not found." };

  revalidateRecurring();
  return { success: true };
}

export async function deleteRecurringRule(
  _prev: RecurringFormState,
  formData: FormData
): Promise<RecurringFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) return { error: "Invalid recurring rule" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_rules")
    .delete()
    .eq("id", parsedId.data)
    .eq("household_id", household.id)
    .select("id");
  if (error) {
    console.error("[recurring] delete failed", error);
    return { error: "Could not delete the recurring rule." };
  }
  if (!data || data.length === 0) return { error: "Recurring rule not found." };

  revalidateRecurring();
  return { success: true };
}

/**
 * Post the current due instance: creates the transaction via the
 * post_recurring_rule RPC (which uses create_transaction, so the balance stays
 * consistent) and advances next_due_date — atomically and idempotently. Returns
 * `notDue` when the rule isn't currently due (nothing posted).
 */
export async function postRecurringRule(id: string): Promise<RecurringFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { error: "Invalid recurring rule" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_recurring_rule", {
    p_id: parsedId.data,
  });
  if (error) {
    console.error("[recurring] post failed", error);
    return { error: "Could not post the recurring rule." };
  }

  revalidateRecurring();
  // data is the new transaction id, or null when the rule wasn't due.
  if (data == null) return { success: true, notDue: true };
  return { success: true };
}
