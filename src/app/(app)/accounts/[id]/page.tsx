import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getAccount } from "@/lib/accounts";
import { ACCOUNT_TYPE_LABELS, isLiability } from "@/lib/accounts-meta";
import { MoneyAmount } from "@/components/shared/money-amount";
import { EditAccountButton } from "@/components/accounts/edit-account-button";
import { AccountRecentTransactions } from "@/components/transactions/account-recent-transactions";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Account · Roundtable Finance",
};

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await getAccount(id);
  if (!account) notFound();

  const liability = isLiability(account.type);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        href="/accounts"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        Accounts
      </Link>

      <Card>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">
                  {account.name}
                </h1>
                {account.is_archived ? (
                  <Badge variant="secondary">Archived</Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground text-sm">
                {ACCOUNT_TYPE_LABELS[account.type]}
                {account.institution ? ` · ${account.institution}` : ""}
              </p>
            </div>
            <EditAccountButton account={account} defaultCurrency={account.currency} />
          </div>

          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">
              {liability ? "Balance owed" : "Current balance"}
            </p>
            <MoneyAmount
              cents={account.current_balance_cents}
              currency={account.currency}
              tone={liability ? "liability" : "auto"}
              className="text-3xl font-semibold tracking-tight"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountRecentTransactions accountId={account.id} />
        </CardContent>
      </Card>
    </div>
  );
}
