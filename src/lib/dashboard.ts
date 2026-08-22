// server-only: dashboard aggregates for the current fiscal month, household-scoped.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";

export interface MonthSummary {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

/**
 * This-month income vs expense. Balance-style counting (matches 1.6): only
 * split_parent_id IS NULL rows count, so a split parent counts once and its
 * children are not double-added. Date range is [start, end).
 */
export async function getMonthSummary(
  start: string,
  end: string
): Promise<MonthSummary> {
  const household = await getCurrentHousehold();
  if (!household) return { incomeCents: 0, expenseCents: 0, netCents: 0 };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("amount_cents, type")
    .eq("household_id", household.id)
    .is("split_parent_id", null)
    .in("type", ["income", "expense"])
    .gte("date", start)
    .lt("date", end);

  if (error || !data) {
    if (error) console.error("[dashboard] month summary failed", error);
    return { incomeCents: 0, expenseCents: 0, netCents: 0 };
  }

  let income = 0;
  let expense = 0;
  for (const r of data as { amount_cents: number; type: string }[]) {
    if (r.type === "income") income += r.amount_cents;
    else if (r.type === "expense") expense += r.amount_cents;
  }
  return { incomeCents: income, expenseCents: expense, netCents: income - expense };
}

export interface CategorySpend {
  categoryId: string | null;
  name: string;
  color: string;
  valueCents: number;
}

const UNCATEGORIZED_COLOR = "#94a3b8";

/**
 * Spending by category for the fiscal month — the INVERSE of the balance rule.
 * For splits, count the CHILDREN (they carry the real category breakdown) and
 * exclude the split parent; for normal rows, count the row itself. Concretely:
 * include rows that are children (split_parent_id IS NOT NULL) OR childless
 * parents, and exclude any parent that has children. Only expenses count
 * (income/transfers are not spending). Null category → "Uncategorized".
 */
export async function getSpendingByCategory(
  start: string,
  end: string
): Promise<CategorySpend[]> {
  const household = await getCurrentHousehold();
  if (!household) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("id, split_parent_id, category_id, amount_cents, category:categories(name, color)")
    .eq("household_id", household.id)
    .eq("type", "expense")
    .gte("date", start)
    .lt("date", end);

  if (error || !data) {
    if (error) console.error("[dashboard] spending by category failed", error);
    return [];
  }

  type Row = {
    id: string;
    split_parent_id: string | null;
    category_id: string | null;
    amount_cents: number;
    category: { name: string; color: string | null } | { name: string; color: string | null }[] | null;
  };
  const rows = data as unknown as Row[];

  // Parents that have children — these are excluded (children carry the detail).
  const parentsWithChildren = new Set<string>();
  for (const r of rows) {
    if (r.split_parent_id) parentsWithChildren.add(r.split_parent_id);
  }

  const byCategory = new Map<string, CategorySpend>();
  for (const r of rows) {
    const isChild = r.split_parent_id != null;
    const isChildlessParent =
      r.split_parent_id == null && !parentsWithChildren.has(r.id);
    if (!isChild && !isChildlessParent) continue; // a parent with children → skip

    const cat = Array.isArray(r.category) ? r.category[0] : r.category;
    const key = r.category_id ?? "uncategorized";
    const name = r.category_id ? (cat?.name ?? "Category") : "Uncategorized";
    const color = r.category_id ? (cat?.color ?? UNCATEGORIZED_COLOR) : UNCATEGORIZED_COLOR;

    const existing = byCategory.get(key);
    if (existing) existing.valueCents += r.amount_cents;
    else
      byCategory.set(key, {
        categoryId: r.category_id ?? null,
        name,
        color,
        valueCents: r.amount_cents,
      });
  }

  return [...byCategory.values()].sort((a, b) => b.valueCents - a.valueCents);
}
