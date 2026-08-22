import type { BudgetStatus } from "@/lib/budgets-meta";
import { BUDGET_STATUS_META } from "@/lib/budgets-meta";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

// Red only for over-budget; amber for near-limit; neutral for on-track.
const STYLES: Record<BudgetStatus, string> = {
  under: "",
  near: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
  over: "border-transparent bg-red-500/15 text-red-700 dark:text-red-400",
};

export function BudgetStatusBadge({ status }: { status: BudgetStatus }) {
  if (status === "under") {
    return <Badge variant="secondary">{BUDGET_STATUS_META.under.label}</Badge>;
  }
  return (
    <Badge variant="outline" className={cn(STYLES[status])}>
      {BUDGET_STATUS_META[status].label}
    </Badge>
  );
}
