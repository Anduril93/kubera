// server-only: debt reads with resolved balance + payoff, household-scoped.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import {
  computePayoff,
  type Debt,
  type DebtWithBalance,
} from "@/lib/debts-meta";

const DEBT_SELECT = `
  id, name, type, principal_cents, apr, minimum_payment_cents, due_day,
  linked_account_id, plaid_account_id, created_at,
  linked_account:accounts!linked_account_id(id, name, current_balance_cents, currency)
`;

// numeric(5,2) comes back from PostgREST as a string; coerce to number.
function toApr(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Debts with resolved balance. Linked debts read the linked account's live
 * balance (a liability account's amount owed); manual debts use principal_cents.
 * `defaultCurrency` is used for manual debts.
 */
export async function getDebts(
  defaultCurrency = "USD"
): Promise<DebtWithBalance[]> {
  const household = await getCurrentHousehold();
  if (!household) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("debts")
    .select(DEBT_SELECT)
    .eq("household_id", household.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[debts] list failed", error);
    return [];
  }

  const debts = (data ?? []) as unknown as Debt[];

  return debts.map((debt) => {
    const linked =
      debt.linked_account_id != null && debt.linked_account != null;
    const mode = linked ? "linked" : "manual";
    const balanceCents = linked
      ? (debt.linked_account?.current_balance_cents ?? 0)
      : debt.principal_cents;
    const currency = linked
      ? (debt.linked_account?.currency ?? defaultCurrency)
      : defaultCurrency;
    const apr = toApr(debt.apr);

    return {
      debt,
      mode,
      linkedAccountName: linked ? (debt.linked_account?.name ?? null) : null,
      currency,
      balanceCents,
      apr,
      minimumPaymentCents: debt.minimum_payment_cents,
      dueDay: debt.due_day,
      payoff: computePayoff(balanceCents, apr, debt.minimum_payment_cents),
    } satisfies DebtWithBalance;
  });
}
