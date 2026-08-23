import { cn } from "@/lib/utils";

/** Generic progress bar. `fillClass` sets the fill color (defaults to brand). */
export function ProgressBar({
  percent,
  fillClass,
  className,
}: {
  percent: number;
  fillClass?: string;
  className?: string;
}) {
  const width = Math.min(Math.max(percent, 0), 100);
  return (
    <div
      className={cn(
        "bg-muted h-2 w-full overflow-hidden rounded-full",
        className
      )}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          fillClass ?? "bg-primary"
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
