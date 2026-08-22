// server-only: category reads (system defaults + this household's), under RLS.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CategoryOption } from "@/lib/transactions-meta";

/**
 * Categories visible to the caller: system defaults (household_id IS NULL) plus
 * the household's own, non-archived. RLS handles the scoping.
 */
export async function getCategories(): Promise<CategoryOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, kind, icon, color, household_id")
    .eq("is_archived", false)
    .order("kind", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("[categories] list failed", error);
    return [];
  }
  return (data ?? []) as CategoryOption[];
}
