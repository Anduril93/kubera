"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import { parseAmountInput } from "@/lib/money";
import {
  goalCreateSchema,
  goalUpdateSchema,
  contributionSchema,
  GOAL_MANUAL,
  type GoalFormState,
} from "@/lib/validations/goal";

const idSchema = z.string().uuid();
const DEFAULT_COLOR = "#10b981";
const DEFAULT_ICON = "PiggyBank";

function revalidateGoals() {
  revalidatePath("/goals");
  revalidatePath("/dashboard");
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function accountIsVisible(supabase: ServerClient, id: string) {
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  return !!data;
}

/** Resolve the linked/manual mode from the submitted linked_account_id value. */
function resolveLink(value: string | undefined): string | null {
  if (!value || value === GOAL_MANUAL) return null;
  return value;
}

export async function createGoal(
  _prev: GoalFormState,
  formData: FormData
): Promise<GoalFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = goalCreateSchema.safeParse({
    name: formData.get("name"),
    target_amount: formData.get("target_amount"),
    target_date: formData.get("target_date") ?? undefined,
    linked_account_id: formData.get("linked_account_id") ?? undefined,
    current_amount: formData.get("current_amount") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let targetCents: number;
  try {
    targetCents = parseAmountInput(parsed.data.target_amount);
  } catch {
    return { error: "Enter a valid target amount" };
  }

  const linkedAccountId = resolveLink(parsed.data.linked_account_id);
  const supabase = await createClient();
  if (linkedAccountId && !(await accountIsVisible(supabase, linkedAccountId))) {
    return { error: "That account isn't available." };
  }

  // Starting amount only applies to manual goals.
  let currentCents = 0;
  if (!linkedAccountId && parsed.data.current_amount) {
    try {
      currentCents = parseAmountInput(parsed.data.current_amount);
    } catch {
      return { error: "Enter a valid starting amount" };
    }
  }

  const { error } = await supabase.from("savings_goals").insert({
    household_id: household.id,
    name: parsed.data.name,
    target_amount_cents: targetCents,
    target_date: parsed.data.target_date ? parsed.data.target_date : null,
    linked_account_id: linkedAccountId,
    current_amount_cents: currentCents,
    color: DEFAULT_COLOR,
    icon: DEFAULT_ICON,
  });
  if (error) {
    console.error("[goals] create failed", error);
    return { error: "Could not create the goal." };
  }

  revalidateGoals();
  return { success: true };
}

export async function updateGoal(
  _prev: GoalFormState,
  formData: FormData
): Promise<GoalFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = goalUpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    target_amount: formData.get("target_amount"),
    target_date: formData.get("target_date") ?? undefined,
    linked_account_id: formData.get("linked_account_id") ?? undefined,
    current_amount: formData.get("current_amount") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let targetCents: number;
  try {
    targetCents = parseAmountInput(parsed.data.target_amount);
  } catch {
    return { error: "Enter a valid target amount" };
  }

  const linkedAccountId = resolveLink(parsed.data.linked_account_id);
  const supabase = await createClient();
  if (linkedAccountId && !(await accountIsVisible(supabase, linkedAccountId))) {
    return { error: "That account isn't available." };
  }

  // current_amount_cents is managed via contributions, not edited here.
  const { data, error } = await supabase
    .from("savings_goals")
    .update({
      name: parsed.data.name,
      target_amount_cents: targetCents,
      target_date: parsed.data.target_date ? parsed.data.target_date : null,
      linked_account_id: linkedAccountId,
    })
    .eq("id", parsed.data.id)
    .eq("household_id", household.id)
    .select("id");
  if (error) {
    console.error("[goals] update failed", error);
    return { error: "Could not update the goal." };
  }
  if (!data || data.length === 0) return { error: "Goal not found." };

  revalidateGoals();
  return { success: true };
}

export async function deleteGoal(
  _prev: GoalFormState,
  formData: FormData
): Promise<GoalFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) return { error: "Invalid goal" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("savings_goals")
    .delete()
    .eq("id", parsedId.data)
    .eq("household_id", household.id)
    .select("id");
  if (error) {
    console.error("[goals] delete failed", error);
    return { error: "Could not delete the goal." };
  }
  if (!data || data.length === 0) return { error: "Goal not found." };

  revalidateGoals();
  return { success: true };
}

/**
 * Add (or, with a negative amount, withdraw) to a MANUAL goal's current amount.
 * Rejected for linked goals — the account balance is the source of truth there.
 */
export async function contributeToGoal(
  id: string,
  amount: string
): Promise<GoalFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { error: "Invalid goal" };

  const parsed = contributionSchema.safeParse({ amount });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter an amount" };
  }
  let deltaCents: number;
  try {
    deltaCents = parseAmountInput(parsed.data.amount, { allowNegative: true });
  } catch {
    return { error: "Enter a valid amount" };
  }

  const supabase = await createClient();
  const { data: goal } = await supabase
    .from("savings_goals")
    .select("id, linked_account_id")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (!goal) return { error: "Goal not found." };
  if (goal.linked_account_id) {
    return {
      error:
        "This goal tracks an account balance — contributions are automatic, not manual.",
    };
  }

  const { error } = await supabase.rpc("contribute_to_goal", {
    p_id: parsedId.data,
    p_delta: deltaCents,
  });
  if (error) {
    console.error("[goals] contribute failed", error);
    return { error: "Could not record the contribution." };
  }

  revalidateGoals();
  return { success: true };
}
