"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import { parseAmountInput } from "@/lib/money";
import {
  budgetCreateSchema,
  budgetUpdateSchema,
  type BudgetFormState,
} from "@/lib/validations/budget";

const idSchema = z.string().uuid();
const UNIQUE_VIOLATION = "23505";

function revalidateBudgets() {
  revalidatePath("/budgets");
  revalidatePath("/dashboard");
}

/** A budget may only reference a category visible to the household (system
 * default or its own custom) — RLS on categories returns exactly those. */
async function categoryIsVisible(
  supabase: Awaited<ReturnType<typeof createClient>>,
  categoryId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .maybeSingle();
  return !!data;
}

export async function createBudget(
  _prev: BudgetFormState,
  formData: FormData
): Promise<BudgetFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = budgetCreateSchema.safeParse({
    category_id: formData.get("category_id"),
    period: formData.get("period"),
    amount: formData.get("amount"),
    rollover: formData.get("rollover") === "true",
    start_date: formData.get("start_date") ?? undefined,
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
  if (!(await categoryIsVisible(supabase, parsed.data.category_id))) {
    return { error: "That category isn't available." };
  }

  const { error } = await supabase.from("budgets").insert({
    household_id: household.id,
    category_id: parsed.data.category_id,
    period: parsed.data.period,
    amount_cents: amountCents,
    rollover: parsed.data.rollover ?? false,
    start_date: parsed.data.start_date,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: "A budget already exists for this category and period." };
    }
    console.error("[budgets] create failed", error);
    return { error: "Could not create the budget." };
  }

  revalidateBudgets();
  return { success: true };
}

export async function updateBudget(
  _prev: BudgetFormState,
  formData: FormData
): Promise<BudgetFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = budgetUpdateSchema.safeParse({
    id: formData.get("id"),
    category_id: formData.get("category_id"),
    period: formData.get("period"),
    amount: formData.get("amount"),
    rollover: formData.get("rollover") === "true",
    start_date: formData.get("start_date") ?? undefined,
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
  if (!(await categoryIsVisible(supabase, parsed.data.category_id))) {
    return { error: "That category isn't available." };
  }

  const patch: Record<string, unknown> = {
    category_id: parsed.data.category_id,
    period: parsed.data.period,
    amount_cents: amountCents,
    rollover: parsed.data.rollover ?? false,
  };
  if (parsed.data.start_date) patch.start_date = parsed.data.start_date;

  const { data, error } = await supabase
    .from("budgets")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("household_id", household.id)
    .select("id");
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: "A budget already exists for this category and period." };
    }
    console.error("[budgets] update failed", error);
    return { error: "Could not update the budget." };
  }
  if (!data || data.length === 0) return { error: "Budget not found." };

  revalidateBudgets();
  return { success: true };
}

export async function deleteBudget(
  _prev: BudgetFormState,
  formData: FormData
): Promise<BudgetFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) return { error: "Invalid budget" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("budgets")
    .delete()
    .eq("id", parsedId.data)
    .eq("household_id", household.id)
    .select("id");
  if (error) {
    console.error("[budgets] delete failed", error);
    return { error: "Could not delete the budget." };
  }
  if (!data || data.length === 0) return { error: "Budget not found." };

  revalidateBudgets();
  return { success: true };
}
