import type { AccountType } from "@/lib/validations/account";

/**
 * Account display metadata + net-position math. Pure module (no server-only
 * imports) so client components can use it too.
 */

/** A row from the `accounts` table. */
export interface Account {
  id: string;
  household_id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  current_balance_cents: number;
  currency: string;
  is_manual: boolean;
  is_archived: boolean;
  plaid_item_id: string | null;
  plaid_account_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Display order for grouping. */
export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  "checking",
  "savings",
  "credit_card",
  "cash",
  "investment",
  "loan",
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit Card",
  cash: "Cash",
  investment: "Investment",
  loan: "Loan",
};

/** Types whose balance is money OWED (subtracts from net position). */
export const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  "credit_card",
  "loan",
]);

export function isLiability(type: AccountType): boolean {
  return LIABILITY_TYPES.has(type);
}

export interface NetPosition {
  assetsCents: number;
  liabilitiesCents: number;
  netCents: number;
}

/** Net position = sum(asset balances) − sum(liability balances). */
export function computeNetPosition(accounts: Account[]): NetPosition {
  let assetsCents = 0;
  let liabilitiesCents = 0;
  for (const a of accounts) {
    if (isLiability(a.type)) liabilitiesCents += a.current_balance_cents;
    else assetsCents += a.current_balance_cents;
  }
  return { assetsCents, liabilitiesCents, netCents: assetsCents - liabilitiesCents };
}

export interface AccountGroup {
  type: AccountType;
  label: string;
  accounts: Account[];
  subtotalCents: number;
}

/** Group accounts by type in display order, skipping empty groups. */
export function groupAccountsByType(accounts: Account[]): AccountGroup[] {
  return ACCOUNT_TYPE_ORDER.map((type) => {
    const inType = accounts.filter((a) => a.type === type);
    return {
      type,
      label: ACCOUNT_TYPE_LABELS[type],
      accounts: inType,
      subtotalCents: inType.reduce((sum, a) => sum + a.current_balance_cents, 0),
    };
  }).filter((g) => g.accounts.length > 0);
}
