import { format } from "date-fns";

/**
 * Fiscal-month range math. Pure module (no server-only imports). The month
 * boundary respects the household member's profiles.fiscal_month_start_day —
 * never hardcode the 1st.
 */

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface FiscalRange {
  /** Inclusive start date (yyyy-mm-dd). */
  start: string;
  /** Exclusive end date (yyyy-mm-dd) — the next period's start. */
  end: string;
  /** Human label, e.g. "June 2026" or "Jun 15 – Jul 14". */
  label: string;
}

/**
 * The fiscal month that contains `today`, given a start day (clamped 1..28).
 * If today's day-of-month is before the start day, the period began last month.
 */
export function fiscalMonthRange(today: Date, startDay: number): FiscalRange {
  const d = Math.min(Math.max(Math.trunc(startDay) || 1, 1), 28);

  let sy = today.getFullYear();
  let sm = today.getMonth(); // 0-based
  if (today.getDate() < d) {
    sm -= 1;
    if (sm < 0) {
      sm = 11;
      sy -= 1;
    }
  }

  const start = new Date(sy, sm, d);
  const end = new Date(sy, sm + 1, d); // exclusive
  const lastIncluded = new Date(sy, sm + 1, d - 1);

  const label =
    d === 1
      ? format(start, "LLLL yyyy")
      : `${format(start, "MMM d")} – ${format(lastIncluded, "MMM d")}`;

  return { start: ymd(start), end: ymd(end), label };
}

/** The Monday–Sunday week containing `today` (end is the next Monday, exclusive). */
export function weekRangeMonSun(today: Date): FiscalRange {
  const daysSinceMonday = (today.getDay() + 6) % 7; // getDay: 0=Sun..6=Sat
  const monday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - daysSinceMonday
  );
  const nextMonday = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 7
  );
  const sunday = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 6
  );
  return {
    start: ymd(monday),
    end: ymd(nextMonday),
    label: `${format(monday, "MMM d")} – ${format(sunday, "MMM d")}`,
  };
}
