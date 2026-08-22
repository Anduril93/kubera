import {
  budgetStatus,
  BUDGET_STATUS_META,
  type BudgetWithSpend,
} from "@/lib/budgets-meta";
import { formatCurrency } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BudgetProgress } from "@/components/budgets/budget-progress";

export function BudgetsTotalCard({
  budgets,
  currency,
}: {
  budgets: BudgetWithSpend[];
  currency: string;
}) {
  const totalBudgeted = budgets.reduce((s, b) => s + b.amountCents, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spentCents, 0);
  const remaining = totalBudgeted - totalSpent;
  const percent =
    totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 100) : 0;
  const status = budgetStatus(totalSpent, totalBudgeted);
  const over = status === "over";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">All budgets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <p className="text-sm">
            <span className="text-2xl font-semibold tracking-tight tabular-figures">
              {formatCurrency(totalSpent, currency)}
            </span>{" "}
            <span className="text-muted-foreground">
              spent of{" "}
              <span className="tabular-figures">
                {formatCurrency(totalBudgeted, currency)}
              </span>
            </span>
          </p>
          {over ? (
            <span className="tabular-figures text-sm font-medium text-red-600 dark:text-red-500">
              {formatCurrency(-remaining, currency)} over
            </span>
          ) : (
            <span className="text-muted-foreground tabular-figures text-sm">
              {formatCurrency(remaining, currency)} left
            </span>
          )}
        </div>
        <BudgetProgress
          percent={percent}
          fillClass={BUDGET_STATUS_META[status].fillClass}
        />
      </CardContent>
    </Card>
  );
}
