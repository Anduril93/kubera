import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";

import { getLedger, type LedgerFilters } from "@/lib/transactions";
import { getAccounts } from "@/lib/accounts";
import { getCategories } from "@/lib/categories-data";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AddTransactionButton } from "@/components/transactions/add-transaction-button";
import { ScanReceiptButton } from "@/components/transactions/scan-receipt-button";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { LedgerTable } from "@/components/transactions/ledger-table";

export const metadata: Metadata = {
  title: "Transactions · Roundtable Finance",
};

const PAGE_SIZE = 25;

type SearchParams = Record<string, string | string[] | undefined>;

function str(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(str(sp, "page") ?? "1") || 1);

  const filters: LedgerFilters = {
    from: str(sp, "from"),
    to: str(sp, "to"),
    accountId: str(sp, "account"),
    categoryId: str(sp, "category"),
    type: str(sp, "type"),
    search: str(sp, "q"),
  };

  const [{ items, total }, accounts, categories] = await Promise.all([
    getLedger(filters, page, PAGE_SIZE),
    getAccounts(),
    getCategories(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(
    filters.from || filters.to || filters.accountId || filters.categoryId || filters.type || filters.search
  );

  function pageHref(p: number) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string") next.set(k, v);
    }
    next.set("page", String(p));
    return `/transactions?${next.toString()}`;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <div className="flex items-center gap-2">
          <ScanReceiptButton accounts={accounts} categories={categories} />
          <AddTransactionButton accounts={accounts} categories={categories} />
        </div>
      </header>

      <TransactionFilters accounts={accounts} categories={categories} />

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="bg-muted rounded-full p-3">
              <Receipt className="text-muted-foreground size-6" />
            </div>
            <p className="text-muted-foreground max-w-sm text-sm">
              {hasFilters
                ? "No transactions match these filters."
                : accounts.length === 0
                  ? "Add an account first, then record transactions here."
                  : "No transactions yet. Add your first one to start the ledger."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {total} transaction{total === 1 ? "" : "s"}
          </p>
          <LedgerTable items={items} accounts={accounts} categories={categories} />

          {totalPages > 1 ? (
            <div className="flex items-center justify-between pt-1">
              <p className="text-muted-foreground text-sm">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  asChild={page > 1}
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                >
                  {page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : <span>Previous</span>}
                </Button>
                <Button
                  asChild={page < totalPages}
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                >
                  {page < totalPages ? <Link href={pageHref(page + 1)}>Next</Link> : <span>Next</span>}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
