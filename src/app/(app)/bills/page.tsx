import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";

import { getRecurringRules } from "@/lib/recurring";
import { getAccounts } from "@/lib/accounts";
import { getCategories } from "@/lib/categories-data";
import {
  classifyRules,
  computeMonthAheadTotals,
  toYmd,
  type RecurringRule,
} from "@/lib/recurring-meta";
import type { Account } from "@/lib/accounts-meta";
import type { CategoryOption } from "@/lib/transactions-meta";
import { Card, CardContent } from "@/components/ui/card";
import { AddBillButton } from "@/components/bills/add-bill-button";
import { MonthAheadCard } from "@/components/bills/month-ahead-card";
import { BillItem } from "@/components/bills/bill-item";

export const metadata: Metadata = {
  title: "Bills & income · Roundtable Finance",
};

function Section({
  title,
  rules,
  accounts,
  categories,
  currency,
  todayYmd,
  titleClassName,
}: {
  title: string;
  rules: RecurringRule[];
  accounts: Account[];
  categories: CategoryOption[];
  currency: string;
  todayYmd: string;
  titleClassName?: string;
}) {
  if (rules.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className={titleClassName ?? "text-muted-foreground text-sm font-medium"}>
        {title}
      </h2>
      <div className="grid gap-3">
        {rules.map((r) => (
          <BillItem
            key={r.id}
            rule={r}
            accounts={accounts}
            categories={categories}
            currency={currency}
            todayYmd={todayYmd}
          />
        ))}
      </div>
    </section>
  );
}

export default async function BillsPage() {
  const [rules, accounts, categories] = await Promise.all([
    getRecurringRules(),
    getAccounts(),
    getCategories(),
  ]);

  const currency = accounts[0]?.currency ?? "USD";
  const now = new Date();
  const todayYmd = toYmd(now);
  const { overdue, upcoming } = classifyRules(rules, now, 30);
  const totals = computeMonthAheadTotals(rules, now, 30);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Bills & income</h1>
        {rules.length > 0 ? (
          <AddBillButton accounts={accounts} categories={categories} />
        ) : null}
      </header>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="bg-muted rounded-full p-3">
              <CalendarClock className="text-muted-foreground size-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-medium">No recurring rules yet</h2>
              <p className="text-muted-foreground mx-auto max-w-sm text-sm">
                Add your recurring bills and income (rent, salary,
                subscriptions) to see what&rsquo;s coming up and post each one
                when it&rsquo;s due.
              </p>
            </div>
            <AddBillButton accounts={accounts} categories={categories} />
          </CardContent>
        </Card>
      ) : (
        <>
          <MonthAheadCard totals={totals} currency={currency} />

          <Section
            title="Overdue"
            titleClassName="text-sm font-semibold text-red-600 dark:text-red-500"
            rules={overdue}
            accounts={accounts}
            categories={categories}
            currency={currency}
            todayYmd={todayYmd}
          />
          <Section
            title="Upcoming · next 30 days"
            rules={upcoming}
            accounts={accounts}
            categories={categories}
            currency={currency}
            todayYmd={todayYmd}
          />
          <Section
            title="All recurring rules"
            rules={rules}
            accounts={accounts}
            categories={categories}
            currency={currency}
            todayYmd={todayYmd}
          />
        </>
      )}
    </div>
  );
}
