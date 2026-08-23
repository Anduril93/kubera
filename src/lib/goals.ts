// server-only: savings-goal reads with resolved progress, household-scoped.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import {
  computeGoalProgress,
  type GoalWithProgress,
  type SavingsGoal,
} from "@/lib/goals-meta";

const GOAL_SELECT = `
  id, name, target_amount_cents, target_date, linked_account_id,
  current_amount_cents, color, icon, created_at,
  linked_account:accounts!linked_account_id(id, name, current_balance_cents, currency)
`;

/**
 * Goals with resolved progress. Linked goals read their account's live balance
 * (so they update whenever that balance changes); manual goals use
 * current_amount_cents. `defaultCurrency` is used for manual goals.
 */
export async function getGoals(
  defaultCurrency = "USD"
): Promise<GoalWithProgress[]> {
  const household = await getCurrentHousehold();
  if (!household) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("savings_goals")
    .select(GOAL_SELECT)
    .eq("household_id", household.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[goals] list failed", error);
    return [];
  }

  const goals = (data ?? []) as unknown as SavingsGoal[];
  const today = new Date();

  return goals.map((goal) => {
    const linked = goal.linked_account_id != null && goal.linked_account != null;
    const mode = linked ? "linked" : "manual";
    const currentCents = linked
      ? (goal.linked_account?.current_balance_cents ?? 0)
      : goal.current_amount_cents;
    const currency = linked
      ? (goal.linked_account?.currency ?? defaultCurrency)
      : defaultCurrency;

    const { percentComplete, remainingCents, isComplete, pace } =
      computeGoalProgress({
        mode,
        currentCents,
        targetCents: goal.target_amount_cents,
        createdAt: goal.created_at,
        targetDate: goal.target_date,
        today,
      });

    return {
      goal,
      mode,
      linkedAccountName: linked ? (goal.linked_account?.name ?? null) : null,
      currency,
      currentCents,
      targetCents: goal.target_amount_cents,
      percentComplete,
      remainingCents,
      isComplete,
      pace,
    } satisfies GoalWithProgress;
  });
}
