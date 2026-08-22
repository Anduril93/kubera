import type { CategorySpend } from "@/lib/dashboard";
import { MoneyAmount } from "@/components/shared/money-amount";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SpendingChart } from "@/components/dashboard/spending-chart";

export function SpendingByCategoryCard({
  data,
  currency,
}: {
  data: CategorySpend[];
  currency: string;
}) {
  const total = data.reduce((s, d) => s + d.valueCents, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Spending by category</CardTitle>
        {total > 0 ? (
          <MoneyAmount
            cents={total}
            currency={currency}
            tone="neutral"
            className="text-sm font-medium"
          />
        ) : null}
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No spending recorded this month yet.
          </p>
        ) : (
          <SpendingChart data={data} currency={currency} />
        )}
      </CardContent>
    </Card>
  );
}
