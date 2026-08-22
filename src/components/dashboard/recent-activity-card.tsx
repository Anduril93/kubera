import Link from "next/link";
import { format, parseISO } from "date-fns";

import { signedAmountCents, type LedgerItem } from "@/lib/transactions-meta";
import { MoneyAmount } from "@/components/shared/money-amount";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function RecentActivityCard({ items }: { items: LedgerItem[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Recent activity</CardTitle>
        <Link
          href="/transactions"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">No transactions yet.</p>
        ) : (
          <ul className="divide-border divide-y">
            {items.map(({ transaction: t, children }) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {t.merchant || t.description || "—"}
                    </span>
                    {children.length > 0 ? (
                      <Badge variant="secondary" className="text-xs">
                        Split
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground truncate text-sm">
                    {format(parseISO(t.date), "MMM d")}
                    {t.account?.name ? ` · ${t.account.name}` : ""}
                    {t.category?.name ? ` · ${t.category.name}` : ""}
                  </p>
                </div>
                <MoneyAmount
                  cents={signedAmountCents(t.type, t.amount_cents)}
                  currency={t.currency}
                  tone="signed"
                  className="font-medium"
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
