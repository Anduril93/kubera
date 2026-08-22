import Link from "next/link";

import { groupAccountsByType, isLiability, type Account } from "@/lib/accounts-meta";
import { MoneyAmount } from "@/components/shared/money-amount";
import { Card } from "@/components/ui/card";
import { AccountRowActions } from "@/components/accounts/account-row-actions";

export function AccountsList({
  accounts,
  currency,
  defaultCurrency,
}: {
  accounts: Account[];
  currency: string;
  defaultCurrency?: string;
}) {
  const groups = groupAccountsByType(accounts);

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const liability = isLiability(group.type);
        return (
          <section key={group.type} className="space-y-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-muted-foreground text-sm font-medium">
                {group.label}
              </h2>
              <MoneyAmount
                cents={group.subtotalCents}
                currency={currency}
                tone={liability ? "liability" : "auto"}
                className="text-sm font-medium"
              />
            </div>
            <Card className="py-0">
              <ul className="divide-border divide-y">
                {group.accounts.map((account) => (
                  <li
                    key={account.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/accounts/${account.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {account.name}
                      </Link>
                      {account.institution ? (
                        <p className="text-muted-foreground truncate text-sm">
                          {account.institution}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <MoneyAmount
                        cents={account.current_balance_cents}
                        currency={account.currency}
                        tone={liability ? "liability" : "auto"}
                        className="text-right font-medium"
                      />
                      <AccountRowActions
                        account={account}
                        defaultCurrency={defaultCurrency}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        );
      })}
    </div>
  );
}
