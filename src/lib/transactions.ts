// server-only: ledger reads, household-scoped via RLS.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import type {
  LedgerItem,
  LedgerTransaction,
} from "@/lib/transactions-meta";

// created_by → profiles is readable for co-members via the 0002 policy, so the
// regular server client resolves "who entered it".
const LEDGER_SELECT = `
  id, account_id, category_id, type, amount_cents, currency, description, merchant,
  date, notes, pending, split_parent_id, created_by,
  category:categories(id, name, kind, icon, color),
  account:accounts(id, name, type),
  creator:profiles!created_by(full_name, email)
`;

export interface LedgerFilters {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  type?: string;
  search?: string;
}

export interface LedgerResult {
  items: LedgerItem[];
  total: number;
  page: number;
  pageSize: number;
}

// Strip characters that would break the PostgREST .or()/ilike filter syntax.
function sanitizeSearch(q: string): string {
  return q.replace(/[,()%*]/g, " ").trim();
}

export async function getLedger(
  filters: LedgerFilters,
  page = 1,
  pageSize = 25
): Promise<LedgerResult> {
  const household = await getCurrentHousehold();
  if (!household) return { items: [], total: 0, page, pageSize };

  const supabase = await createClient();

  // Top-level rows only (parents + standalone); children never appear here.
  let query = supabase
    .from("transactions")
    .select(LEDGER_SELECT, { count: "exact" })
    .eq("household_id", household.id)
    .is("split_parent_id", null);

  if (filters.from) query = query.gte("date", filters.from);
  if (filters.to) query = query.lte("date", filters.to);
  if (filters.accountId) query = query.eq("account_id", filters.accountId);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.search) {
    const q = sanitizeSearch(filters.search);
    if (q) query = query.or(`description.ilike.%${q}%,merchant.ilike.%${q}%`);
  }

  const from = (page - 1) * pageSize;
  query = query
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  const { data, error, count } = await query;
  if (error) {
    console.error("[transactions] ledger failed", error);
    return { items: [], total: 0, page, pageSize };
  }

  const parents = (data ?? []) as unknown as LedgerTransaction[];

  // Fetch split children for the parents on this page, grouped under each.
  const childrenByParent = new Map<string, LedgerTransaction[]>();
  const parentIds = parents.map((p) => p.id);
  if (parentIds.length > 0) {
    const { data: childRows } = await supabase
      .from("transactions")
      .select(LEDGER_SELECT)
      .in("split_parent_id", parentIds)
      .order("created_at", { ascending: true });
    for (const c of (childRows ?? []) as unknown as LedgerTransaction[]) {
      const key = c.split_parent_id as string;
      const list = childrenByParent.get(key) ?? [];
      list.push(c);
      childrenByParent.set(key, list);
    }
  }

  const items: LedgerItem[] = parents.map((transaction) => ({
    transaction,
    children: childrenByParent.get(transaction.id) ?? [],
  }));

  return { items, total: count ?? 0, page, pageSize };
}

/** Recent top-level transactions for one account (account detail page). */
export async function getAccountRecentTransactions(
  accountId: string,
  limit = 8
): Promise<LedgerTransaction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select(LEDGER_SELECT)
    .eq("account_id", accountId)
    .is("split_parent_id", null)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[transactions] account recent failed", error);
    return [];
  }
  return (data ?? []) as unknown as LedgerTransaction[];
}
