import type { Metadata } from "next";
import { Target } from "lucide-react";

import { getBudgetsWithSpend } from "@/lib/budgets";
import { getCategories } from "@/lib/categories-data";
import { getAccounts } from "@/lib/accounts";
import { Card, CardContent } from "@/components/ui/card";
import { AddBudgetButton } from "@/components/budgets/add-budget-button";
import { BudgetsTotalCard } from "@/components/budgets/budgets-total-card";
import { BudgetItem } from "@/components/budgets/budget-item";

export const metadata: Metadata = {
  title: "Budgets · Roundtable Finance",
};

export default async function BudgetsPage() {
  const [budgets, categories, accounts] = await Promise.all([
    getBudgetsWithSpend(),
    getCategories(),
    getAccounts(),
  ]);

  const expenseCategories = categories.filter((c) => c.kind === "expense");
  const currency = accounts[0]?.currency ?? "USD";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Budgets</h1>
        {budgets.length > 0 ? (
          <AddBudgetButton categories={expenseCategories} />
        ) : null}
      </header>

      {budgets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="bg-muted rounded-full p-3">
              <Target className="text-muted-foreground size-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-medium">No budgets yet</h2>
              <p className="text-muted-foreground mx-auto max-w-sm text-sm">
                Set a spending limit for a category and track how much of it
                you&rsquo;ve used this period.
              </p>
            </div>
            <AddBudgetButton categories={expenseCategories} />
          </CardContent>
        </Card>
      ) : (
        <>
          <BudgetsTotalCard budgets={budgets} currency={currency} />
          <div className="grid gap-3">
            {budgets.map((b) => (
              <BudgetItem
                key={b.id}
                budget={b}
                categories={expenseCategories}
                currency={currency}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
