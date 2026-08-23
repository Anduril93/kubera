import type { DebtType } from "@/lib/validations/debt";

/**
 * Debt display types + payoff math. Pure module (no server-only imports) so
 * client components can use it. Balance mode is ALWAYS explicit: "linked"
 * (balance = linked account's balance) or "manual" (balance = principal_cents).
 */

export const DEBT_TYPE_LABELS: Record<DebtType, string> = {
  credit_card: "Credit card",
  student_loan: "Student loan",
  mortgage: "Mortgage",
  auto: "Auto loan",
  personal: "Personal loan",
  other: "Other",
};

export type DebtMode = "linked" | "manual";

export interface DebtAccountRef {
  id: string;
  name: string;
  current_balance_cents: number;
  currency: string;
}

export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  principal_cents: number;
  apr: number | null;
  minimum_payment_cents: number | null;
  due_day: number | null;
  linked_account_id: string | null;
  plaid_account_id: string | null;
  created_at: string;
  linked_account: DebtAccountRef | null;
}

export type PayoffStatus = "ok" | "min_below_interest" | "no_payment" | "paid_off";

export interface PayoffResult {
  status: PayoffStatus;
  /** Whole months to payoff (only when status === "ok"). */
  months?: number;
}

/**
 * Months to pay off `balanceCents` paying `minPaymentCents` monthly at `apr`
 * (annual %). Degrades gracefully: if the minimum can't cover the monthly
 * interest, returns "min_below_interest" instead of an infinite/garbage number.
 */
export function computePayoff(
  balanceCents: number,
  apr: number | null,
  minPaymentCents: number | null
): PayoffResult {
  if (balanceCents <= 0) return { status: "paid_off" };
  if (minPaymentCents == null || minPaymentCents <= 0) {
    return { status: "no_payment" };
  }

  const P = balanceCents;
  const M = minPaymentCents;
  const monthlyRate = (apr ?? 0) / 100 / 12;

  if (monthlyRate <= 0) {
    return { status: "ok", months: Math.ceil(P / M) };
  }

  const monthlyInterest = P * monthlyRate;
  if (M <= monthlyInterest) {
    return { status: "min_below_interest" };
  }

  const months = Math.ceil(
    -Math.log(1 - (P * monthlyRate) / M) / Math.log(1 + monthlyRate)
  );
  return { status: "ok", months };
}

export function formatPayoffDuration(months: number): string {
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `${years} yr` : `${years} yr ${rem} mo`;
}

export interface DebtWithBalance {
  debt: Debt;
  mode: DebtMode;
  linkedAccountName: string | null;
  currency: string;
  balanceCents: number;
  apr: number | null;
  minimumPaymentCents: number | null;
  dueDay: number | null;
  payoff: PayoffResult;
}
