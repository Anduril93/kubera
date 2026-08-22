import type { BudgetPeriod } from "@/lib/validations/budget";

/**
 * Budget display types + at-a-glance status. Pure module (no server-only
 * imports) so client components can use it.
 */

export interface BudgetCategoryRef {
  id: string;
  name: string;
  kind: string;
  icon: string | null;
  color: string | null;
}

export interface Budget {
  id: string;
  category_id: string;
  period: BudgetPeriod;
  amount_cents: number;
  rollover: boolean;
  start_date: string;
  category: BudgetCategoryRef | null;
}

export interface BudgetWithSpend {
  id: string;
  category: BudgetCategoryRef | null;
  period: BudgetPeriod;
  amountCents: number;
  spentCents: number;
  remainingCents: number;
  /** 0–100+ (can exceed 100 when over budget). */
  percentUsed: number;
  rollover: boolean;
  /** The budget's own start_date (not the current period start). */
  startDate: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
}

export type BudgetStatus = "under" | "near" | "over";

/** Near-limit threshold: 80% of the budgeted amount. */
export const NEAR_LIMIT_RATIO = 0.8;

export function budgetStatus(
  spentCents: number,
  amountCents: number
): BudgetStatus {
  if (amountCents <= 0) return "under";
  if (spentCents > amountCents) return "over";
  if (spentCents / amountCents >= NEAR_LIMIT_RATIO) return "near";
  return "under";
}

export const BUDGET_STATUS_META: Record<
  BudgetStatus,
  { label: string; fillClass: string }
> = {
  // Red is reserved for over-budget only (money semantics). "Near" uses amber
  // as a warning; "under" uses the neutral brand color, not green.
  under: { label: "On track", fillClass: "bg-primary" },
  near: { label: "Near limit", fillClass: "bg-amber-500" },
  over: { label: "Over budget", fillClass: "bg-red-600 dark:bg-red-500" },
};

export const PERIOD_LABELS: Record<BudgetPeriod, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
};
