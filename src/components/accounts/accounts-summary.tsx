import { computeNetPosition, type Account } from "@/lib/accounts-meta";
import { MoneyAmount } from "@/components/shared/money-amount";
import { Card, CardContent } from "@/components/ui/card";

export function AccountsSummary({
  accounts,
  currency,
}: {
  accounts: Account[];
  currency: string;
}) {
  const { assetsCents, liabilitiesCents, netCents } = computeNetPosition(accounts);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">Net position</p>
          <MoneyAmount
            cents={netCents}
            currency={currency}
            tone="signed"
            className="text-3xl font-semibold tracking-tight"
          />
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-3 border-t pt-4">
          <div className="space-y-0.5">
            <p className="text-muted-foreground text-sm">Assets</p>
            <MoneyAmount
              cents={assetsCents}
              currency={currency}
              tone="neutral"
              className="text-lg font-medium"
            />
          </div>
          <div className="space-y-0.5">
            <p className="text-muted-foreground text-sm">Liabilities</p>
            <MoneyAmount
              cents={liabilitiesCents}
              currency={currency}
              tone={liabilitiesCents > 0 ? "liability" : "neutral"}
              className="text-lg font-medium"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
