import { computeNetPosition, type Account } from "@/lib/accounts-meta";
import { MoneyAmount } from "@/components/shared/money-amount";
import { Card, CardContent } from "@/components/ui/card";

/** Net worth = assets − liabilities, via the shared computeNetPosition. */
export function NetWorthCard({
  accounts,
  currency,
}: {
  accounts: Account[];
  currency: string;
}) {
  const { assetsCents, liabilitiesCents, netCents } =
    computeNetPosition(accounts);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">Net worth</p>
          <MoneyAmount
            cents={netCents}
            currency={currency}
            tone="signed"
            className="text-3xl font-semibold tracking-tight"
          />
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2 border-t pt-3 text-sm">
          <div className="space-y-0.5">
            <p className="text-muted-foreground">Assets</p>
            <MoneyAmount cents={assetsCents} currency={currency} tone="neutral" className="font-medium" />
          </div>
          <div className="space-y-0.5">
            <p className="text-muted-foreground">Liabilities</p>
            <MoneyAmount
              cents={liabilitiesCents}
              currency={currency}
              tone={liabilitiesCents > 0 ? "liability" : "neutral"}
              className="font-medium"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
