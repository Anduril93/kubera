// server-only: recurring-rule reads, household-scoped via RLS.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import type { RecurringRule } from "@/lib/recurring-meta";

const RECURRING_SELECT = `
  id, account_id, category_id, name, amount_cents, type, frequency,
  next_due_date, end_date, auto_post,
  account:accounts(id, name),
  category:categories(id, name, color)
`;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function query(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  householdId: string;
} | null> {
  const household = await getCurrentHousehold();
  if (!household) return null;
  return { supabase: await createClient(), householdId: household.id };
}

/** All recurring rules for the household, soonest due first. */
export async function getRecurringRules(): Promise<RecurringRule[]> {
  const q = await query();
  if (!q) return [];
  const { data, error } = await q.supabase
    .from("recurring_rules")
    .select(RECURRING_SELECT)
    .eq("household_id", q.householdId)
    .order("next_due_date", { ascending: true });
  if (error) {
    console.error("[recurring] list failed", error);
    return [];
  }
  return (data ?? []) as unknown as RecurringRule[];
}

/** Rules due within the next `days` days (inclusive of today). */
export async function getUpcomingRecurringRules(
  days = 14
): Promise<RecurringRule[]> {
  const q = await query();
  if (!q) return [];
  const today = new Date();
  const until = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + days
  );
  const { data, error } = await q.supabase
    .from("recurring_rules")
    .select(RECURRING_SELECT)
    .eq("household_id", q.householdId)
    .gte("next_due_date", ymd(today))
    .lte("next_due_date", ymd(until))
    .order("next_due_date", { ascending: true });
  if (error) {
    console.error("[recurring] upcoming failed", error);
    return [];
  }
  return (data ?? []) as unknown as RecurringRule[];
}

/** Rules whose next_due_date is in the past (overdue), oldest first. */
export async function getOverdueRecurringRules(): Promise<RecurringRule[]> {
  const q = await query();
  if (!q) return [];
  const { data, error } = await q.supabase
    .from("recurring_rules")
    .select(RECURRING_SELECT)
    .eq("household_id", q.householdId)
    .lt("next_due_date", ymd(new Date()))
    .order("next_due_date", { ascending: true });
  if (error) {
    console.error("[recurring] overdue failed", error);
    return [];
  }
  return (data ?? []) as unknown as RecurringRule[];
}
