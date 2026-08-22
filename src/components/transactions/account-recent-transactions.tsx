import { format, parseISO } from "date-fns";

import { getAccountRecentTransactions } from "@/lib/transactions";
import { signedAmountCents } from "@/lib/transactions-meta";
import { MoneyAmount } from "@/components/shared/money-amount";

/** Recent top-level transactions for an account (account detail page). */
export async function AccountRecentTransactions({
  accountId,
}: {
  accountId: string;
}) {
  const transactions = await getAccountRecentTransactions(accountId);

  if (transactions.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No transactions yet. This account&rsquo;s recent activity will appear
        here.
      </p>
    );
  }

  return (
    <ul className="divide-border divide-y">
      {transactions.map((t) => (
        <li
          key={t.id}
          className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="truncate font-medium">
              {t.merchant || t.description || "—"}
            </p>
            <p className="text-muted-foreground text-sm">
              {format(parseISO(t.date), "MMM d")}
              {t.category?.name ? ` · ${t.category.name}` : ""}
            </p>
          </div>
          <MoneyAmount
            cents={signedAmountCents(t.type, t.amount_cents)}
            currency={t.currency}
            tone="signed"
            className="font-medium"
          />
        </li>
      ))}
    </ul>
  );
}
