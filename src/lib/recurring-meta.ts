import { addDays, addMonths, addYears, format, parseISO } from "date-fns";

import type {
  RecurringFrequency,
  RecurringType,
} from "@/lib/validations/recurring";

export function toYmd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

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

export function isOverdue(rule: RecurringRule, todayYmd: string): boolean {
  return rule.next_due_date < todayYmd;
}

/** Count how many times a rule falls due within [startYmd, endYmd] (inclusive). */
export function occurrencesInWindow(
  rule: RecurringRule,
  startYmd: string,
  endYmd: string
): number {
  let cursor = rule.next_due_date;
  let count = 0;
  // Guard against pathological loops (e.g. very-overdue weekly rules).
  for (let i = 0; i < 500 && cursor <= endYmd; i++) {
    if (rule.end_date && cursor > rule.end_date) break;
    if (cursor >= startYmd) count += 1;
    cursor = advanceRecurringDate(cursor, rule.frequency);
  }
  return count;
}

export interface MonthAheadTotals {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

/**
 * Expected recurring income/expense over the next `days` days, counting EVERY
 * occurrence in the window (a weekly bill fires ~4x), respecting end_date.
 */
export function computeMonthAheadTotals(
  rules: RecurringRule[],
  today: Date,
  days = 30
): MonthAheadTotals {
  const startYmd = toYmd(today);
  const endYmd = toYmd(addDays(today, days));
  let income = 0;
  let expense = 0;
  for (const r of rules) {
    const n = occurrencesInWindow(r, startYmd, endYmd);
    if (n === 0) continue;
    if (r.type === "income") income += n * r.amount_cents;
    else expense += n * r.amount_cents;
  }
  return { incomeCents: income, expenseCents: expense, netCents: income - expense };
}

export interface ClassifiedRules {
  overdue: RecurringRule[];
  upcoming: RecurringRule[];
}

/** Split rules into overdue (past due) and upcoming (due within `days` days). */
export function classifyRules(
  rules: RecurringRule[],
  today: Date,
  days = 30
): ClassifiedRules {
  const todayYmd = toYmd(today);
  const untilYmd = toYmd(addDays(today, days));
  const overdue: RecurringRule[] = [];
  const upcoming: RecurringRule[] = [];
  for (const r of rules) {
    if (r.next_due_date < todayYmd) overdue.push(r);
    else if (r.next_due_date <= untilYmd) upcoming.push(r);
  }
  return { overdue, upcoming };
}

/** Signed cents for display: income +, expense −. */
export function recurringSignedCents(rule: RecurringRule): number {
  return rule.type === "income" ? rule.amount_cents : -rule.amount_cents;
}
