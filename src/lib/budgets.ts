// server-only: budget reads + derived spend for the current period.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import { getCurrentProfile } from "@/lib/profile";
import { fiscalMonthRange, weekRangeMonSun } from "@/lib/fiscal";
import type { Budget, BudgetWithSpend } from "@/lib/budgets-meta";

export type { Budget, BudgetWithSpend } from "@/lib/budgets-meta";

const BUDGET_SELECT = `
  id, category_id, period, amount_cents, rollover, start_date,
  category:categories(id, name, kind, icon, color)
`;

export async function getBudgets(): Promise<Budget[]> {
  const household = await getCurrentHousehold();
  if (!household) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("budgets")
    .select(BUDGET_SELECT)
    .eq("household_id", household.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[budgets] list failed", error);
    return [];
  }
  return (data ?? []) as unknown as Budget[];
}

/**
 * Each budget with its derived spend for the CURRENT period. Monthly budgets use
 * the household member's fiscal month (reusing fiscalMonthRange +
 * fiscal_month_start_day); weekly budgets run Mon–Sun. Spend is computed by the
 * category_period_spend() SQL function (the category-counting rule).
 */
export async function getBudgetsWithSpend(): Promise<BudgetWithSpend[]> {
  const [household, profile] = await Promise.all([
    getCurrentHousehold(),
    getCurrentProfile(),
  ]);
  if (!household) return [];

  const now = new Date();
  const monthly = fiscalMonthRange(now, profile?.fiscal_month_start_day ?? 1);
  const weekly = weekRangeMonSun(now);

  const budgets = await getBudgets();
  const supabase = await createClient();

  return Promise.all(
    budgets.map(async (b) => {
      const range = b.period === "monthly" ? monthly : weekly;
      const { data, error } = await supabase.rpc("category_period_spend", {
        p_category_id: b.category_id,
        p_start: range.start,
        p_end: range.end,
      });
      if (error) console.error("[budgets] spend rpc failed", error);

      const spentCents = typeof data === "number" ? data : Number(data ?? 0);
      const remainingCents = b.amount_cents - spentCents;
      const percentUsed =
        b.amount_cents > 0
          ? Math.round((spentCents / b.amount_cents) * 100)
          : 0;

      return {
        id: b.id,
        category: b.category,
        period: b.period,
        amountCents: b.amount_cents,
        spentCents,
        remainingCents,
        percentUsed,
        rollover: b.rollover,
        startDate: b.start_date,
        periodStart: range.start,
        periodEnd: range.end,
        periodLabel: range.label,
      };
    })
  );
}
