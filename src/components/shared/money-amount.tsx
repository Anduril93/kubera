import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/money";

/**
 * Renders a monetary amount: formatted via formatCurrency(), in tabular figures,
 * with consistent money color semantics. Red/green are reserved STRICTLY for
 * money sign so they don't compete with the brand accent (CLAUDE.md).
 *
 * tone:
 *  - "auto"      negative → red, otherwise neutral foreground (default; assets)
 *  - "liability" always red (money owed, even though shown as a positive figure)
 *  - "signed"    negative → red, positive → green, zero → neutral (net figures)
 *  - "neutral"   always neutral foreground
 */
type MoneyTone = "auto" | "liability" | "signed" | "neutral";

const MONEY_NEGATIVE = "text-red-600 dark:text-red-500";
const MONEY_POSITIVE = "text-emerald-600 dark:text-emerald-500";

function toneClass(cents: number, tone: MoneyTone): string {
  switch (tone) {
    case "liability":
      return MONEY_NEGATIVE;
    case "signed":
      if (cents < 0) return MONEY_NEGATIVE;
      if (cents > 0) return MONEY_POSITIVE;
      return "text-foreground";
    case "neutral":
      return "text-foreground";
    case "auto":
    default:
      return cents < 0 ? MONEY_NEGATIVE : "text-foreground";
  }
}

export function MoneyAmount({
  cents,
  currency = "USD",
  tone = "auto",
  className,
}: {
  cents: number;
  currency?: string;
  tone?: MoneyTone;
  className?: string;
}) {
  return (
    <span className={cn("tabular-figures", toneClass(cents, tone), className)}>
      {formatCurrency(cents, currency)}
    </span>
  );
}
