// server-only: account data reads, scoped to the caller's household via RLS.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import type { Account } from "@/lib/accounts-meta";

/** Non-archived accounts for the current household. */
export async function getAccounts(): Promise<Account[]> {
  const household = await getCurrentHousehold();
  if (!household) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("household_id", household.id)
    .eq("is_archived", false)
    .order("name", { ascending: true });

  if (error) {
    console.error("[accounts] list failed", error);
    return [];
  }
  return (data ?? []) as Account[];
}

/** A single account by id (RLS restricts to the caller's household). */
export async function getAccount(id: string): Promise<Account | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[accounts] get failed", error);
    return null;
  }
  return (data as Account) ?? null;
}
