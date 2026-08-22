import { addDays, addMonths, addYears, format, parseISO } from "date-fns";

import type {
  RecurringFrequency,
  RecurringType,
} from "@/lib/validations/recurring";

/**
 * Recurring-rule display types + a date helper. Pure module (no server-only
 * imports) so client components can use it.
 */

export interface RecurringAccountRef {
  id: string;
  name: string;
}
export interface RecurringCategoryRef {
  id: string;
  name: string;
  color: string | null;
}

export interface RecurringRule {
  id: string;
  account_id: string;
  category_id: string | null;
  name: string;
  amount_cents: number;
  type: RecurringType;
  frequency: RecurringFrequency;
  next_due_date: string;
  end_date: string | null;
  auto_post: boolean;
  account: RecurringAccountRef | null;
  category: RecurringCategoryRef | null;
}

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

/**
 * Advance a `yyyy-MM-dd` date by one interval. Mirrors the SQL
 * advance_recurring_date: month/quarter/year use date-fns add* which clamp
 * month-end (Jan 31 + 1 month → Feb 28/29), never producing an invalid date.
 */
export function advanceRecurringDate(
  dateStr: string,
  freq: RecurringFrequency
): string {
  const d = parseISO(dateStr);
  let next: Date;
  switch (freq) {
    case "weekly":
      next = addDays(d, 7);
      break;
    case "biweekly":
      next = addDays(d, 14);
      break;
    case "monthly":
      next = addMonths(d, 1);
      break;
    case "quarterly":
      next = addMonths(d, 3);
      break;
    case "yearly":
      next = addYears(d, 1);
      break;
  }
  return format(next, "yyyy-MM-dd");
}
