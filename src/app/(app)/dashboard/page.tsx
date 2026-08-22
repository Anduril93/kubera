import type { Metadata } from "next";

import { getAccounts } from "@/lib/accounts";
import { getCurrentProfile } from "@/lib/profile";
import { getLedger } from "@/lib/transactions";
import { getMonthSummary, getSpendingByCategory } from "@/lib/dashboard";
import { fiscalMonthRange } from "@/lib/fiscal";
import { NetWorthCard } from "@/components/dashboard/net-worth-card";
import { MonthSummaryCard } from "@/components/dashboard/month-summary-card";
import { SpendingByCategoryCard } from "@/components/dashboard/spending-by-category-card";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";
import { InsightsCard } from "@/components/dashboard/insights-card";

export const metadata: Metadata = {
  title: "Dashboard · Roundtable Finance",
};

export default async function DashboardPage() {
  const [accounts, profile] = await Promise.all([
    getAccounts(),
    getCurrentProfile(),
  ]);

  // Fiscal month respects the user's start day (default 1).
  const range = fiscalMonthRange(new Date(), profile?.fiscal_month_start_day ?? 1);
  // Same currency basis as the /accounts net-position card.
  const currency = accounts[0]?.currency ?? "USD";

  const [summary, spending, ledger] = await Promise.all([
    getMonthSummary(range.start, range.end),
    getSpendingByCategory(range.start, range.end),
    getLedger({}, 1, 8),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <NetWorthCard accounts={accounts} currency={currency} />
        <MonthSummaryCard
          summary={summary}
          currency={currency}
          label={range.label}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SpendingByCategoryCard data={spending} currency={currency} />
        <RecentActivityCard items={ledger.items} />
      </div>

      <InsightsCard />
    </div>
  );
}
