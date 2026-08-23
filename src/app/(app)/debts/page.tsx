import type { Metadata } from "next";
import { Landmark } from "lucide-react";

import { getDebts } from "@/lib/debts";
import { getAccounts } from "@/lib/accounts";
import { MoneyAmount } from "@/components/shared/money-amount";
import { Card, CardContent } from "@/components/ui/card";
import { AddDebtButton } from "@/components/debts/add-debt-button";
import { DebtCard } from "@/components/debts/debt-card";

export const metadata: Metadata = {
  title: "Debts · Roundtable Finance",
};

export default async function DebtsPage() {
  const accounts = await getAccounts();
  const currency = accounts[0]?.currency ?? "USD";
  const debts = await getDebts(currency);
  const totalDebtCents = debts.reduce((sum, d) => sum + d.balanceCents, 0);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Debts</h1>
        {debts.length > 0 ? <AddDebtButton accounts={accounts} /> : null}
      </header>

      {debts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="bg-muted rounded-full p-3">
              <Landmark className="text-muted-foreground size-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-medium">No debts tracked</h2>
              <p className="text-muted-foreground mx-auto max-w-sm text-sm">
                Track credit cards, loans and mortgages — link an account to
                follow its balance, or maintain the balance manually. See a
                payoff estimate for each.
              </p>
            </div>
            <AddDebtButton accounts={accounts} />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-1">
              <p className="text-muted-foreground text-sm">Total debt</p>
              <MoneyAmount
                cents={totalDebtCents}
                currency={currency}
                tone={totalDebtCents > 0 ? "liability" : "neutral"}
                className="text-3xl font-semibold tracking-tight"
              />
              <p className="text-muted-foreground text-xs">
                Shown here for tracking. Net worth counts debt only through
                linked account balances, never twice.
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            {debts.map((item) => (
              <DebtCard key={item.debt.id} item={item} accounts={accounts} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
