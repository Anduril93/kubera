import type { MonthSummary } from "@/lib/dashboard";
import { MoneyAmount } from "@/components/shared/money-amount";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function MonthSummaryCard({
  summary,
  currency,
  label,
}: {
  summary: MonthSummary;
  currency: string;
  label: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">This month</CardTitle>
        <p className="text-muted-foreground text-sm">{label}</p>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-3 gap-2">
          <div className="space-y-0.5">
            <dt className="text-muted-foreground text-sm">Income</dt>
            <dd>
              <MoneyAmount
                cents={summary.incomeCents}
                currency={currency}
                tone={summary.incomeCents > 0 ? "signed" : "neutral"}
                className="font-medium"
              />
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground text-sm">Expenses</dt>
            <dd>
              <MoneyAmount
                cents={summary.expenseCents}
                currency={currency}
                tone={summary.expenseCents > 0 ? "liability" : "neutral"}
                className="font-medium"
              />
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground text-sm">Net</dt>
            <dd>
              <MoneyAmount
                cents={summary.netCents}
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
