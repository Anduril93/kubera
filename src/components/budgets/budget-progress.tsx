import { cn } from "@/lib/utils";

/** Pure progress bar. `fillClass` carries the money-state color. */
export function BudgetProgress({
  percent,
  fillClass,
}: {
  percent: number;
  fillClass: string;
}) {
  const width = Math.min(Math.max(percent, 0), 100);
  return (
    <div
      className="bg-muted h-2 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", fillClass)}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
