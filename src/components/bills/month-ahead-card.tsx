import type { MonthAheadTotals } from "@/lib/recurring-meta";
import { MoneyAmount } from "@/components/shared/money-amount";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function MonthAheadCard({
  totals,
  currency,
}: {
  totals: MonthAheadTotals;
  currency: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Next 30 days</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-3 gap-2">
          <div className="space-y-0.5">
            <dt className="text-muted-foreground text-sm">Income</dt>
            <dd>
              <MoneyAmount
                cents={totals.incomeCents}
                currency={currency}
                tone={totals.incomeCents > 0 ? "signed" : "neutral"}
                className="font-medium"
              />
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground text-sm">Expenses</dt>
            <dd>
              <MoneyAmount
                cents={totals.expenseCents}
                currency={currency}
                tone={totals.expenseCents > 0 ? "liability" : "neutral"}
                className="font-medium"
              />
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground text-sm">Net</dt>
            <dd>
              <MoneyAmount
                cents={totals.netCents}
                currency={currency}
                tone="signed"
                className="font-medium"
              />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
