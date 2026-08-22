import type { Metadata } from "next";
import { Landmark } from "lucide-react";

import { getAccounts } from "@/lib/accounts";
import { Card, CardContent } from "@/components/ui/card";
import { AccountsSummary } from "@/components/accounts/accounts-summary";
import { AccountsList } from "@/components/accounts/accounts-list";
import { AddAccountButton } from "@/components/accounts/add-account-button";

export const metadata: Metadata = {
  title: "Accounts · Roundtable Finance",
};

export default async function AccountsPage() {
  const accounts = await getAccounts();
  // v1 assumes a single household currency; default to what's already in use.
  const currency = accounts[0]?.currency ?? "USD";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        {accounts.length > 0 ? (
          <AddAccountButton defaultCurrency={currency} />
        ) : null}
      </header>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="bg-muted rounded-full p-3">
              <Landmark className="text-muted-foreground size-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-medium">No accounts yet</h2>
              <p className="text-muted-foreground mx-auto max-w-sm text-sm">
                Add your checking, savings, credit cards and more to track
                balances and your net position.
              </p>
            </div>
            <AddAccountButton defaultCurrency={currency} />
          </CardContent>
        </Card>
      ) : (
        <>
          <AccountsSummary accounts={accounts} currency={currency} />
          <AccountsList
            accounts={accounts}
            currency={currency}
            defaultCurrency={currency}
          />
        </>
      )}
    </div>
  );
}
