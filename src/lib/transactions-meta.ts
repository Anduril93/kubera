import type { TransactionType } from "@/lib/validations/transaction";

/**
 * Transaction display metadata + sign helper. Pure module (no server-only
 * imports) so client components can use it.
 */

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
};

/** Embedded relations resolved by the ledger query. */
export interface TxnCategoryRef {
  id: string;
  name: string;
  kind: string;
  icon: string | null;
  color: string | null;
}
export interface TxnAccountRef {
  id: string;
  name: string;
  type: string;
}
export interface TxnCreatorRef {
  full_name: string | null;
  email: string | null;
}

/** A ledger row with its joined display data. */
export interface LedgerTransaction {
  id: string;
  account_id: string;
  category_id: string | null;
  type: TransactionType;
  amount_cents: number;
  currency: string;
  description: string | null;
  merchant: string | null;
  date: string;
  notes: string | null;
  pending: boolean;
  split_parent_id: string | null;
  created_by: string | null;
  category: TxnCategoryRef | null;
  account: TxnAccountRef | null;
  creator: TxnCreatorRef | null;
}

/** A top-level ledger entry: a parent/standalone row plus any split children. */
export interface LedgerItem {
  transaction: LedgerTransaction;
  children: LedgerTransaction[];
}

/**
 * Signed cents for display, matching the 1.6 balance convention:
 * income increases (+), expense and transfer decrease (−). Pair with
 * MoneyAmount tone="signed" for red/green-by-sign coloring.
 */
export function signedAmountCents(
  type: TransactionType,
  amountCents: number
): number {
  return type === "income" ? amountCents : -amountCents;
}

export function creatorLabel(creator: TxnCreatorRef | null): string | null {
  if (!creator) return null;
  return creator.full_name || creator.email || null;
}

/** A category for the picker (system default when household_id is null). */
export interface CategoryOption {
  id: string;
  name: string;
  kind: string;
  icon: string | null;
  color: string | null;
  household_id: string | null;
}

const KIND_ORDER = ["income", "expense", "transfer"] as const;
const KIND_LABELS: Record<string, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
};

export interface CategoryGroup {
  kind: string;
  label: string;
  categories: CategoryOption[];
}

export function groupCategoriesByKind(
  categories: CategoryOption[]
): CategoryGroup[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABELS[kind],
    categories: categories.filter((c) => c.kind === kind),
  })).filter((g) => g.categories.length > 0);
}
