// server-only: derives the current household from the auth session.
import "server-only";

import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth-helper";

export type HouseholdRole = "owner" | "member";

export interface Household {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
}

/**
 * The household the current user belongs to (v1: a user belongs to one).
 * Returns null if unauthenticated or not yet in a household. Wrapped in
 * React `cache` so repeated calls within one request hit the DB once.
 */
export const getCurrentHousehold = cache(
  async (): Promise<Household | null> => {
    const user = await getAuthUser();
    if (!user) return null;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("household_members")
      .select("role, households(*)")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[household] failed to load current household", error);
      return null;
    }

    // `households` is the joined to-one row.
    const household = (data?.households ?? null) as Household | null;
    return household;
  }
);

export interface RequireHouseholdResult {
  user: User;
  household: Household;
}

/**
 * Guard for Server Actions that operate on household data. Throws when the
 * caller is unauthenticated or has no household — every finance query must be
 * scoped to the returned household.id (RLS enforces this too).
 */
export async function requireHouseholdMember(): Promise<RequireHouseholdResult> {
  const user = await getAuthUser();
  if (!user) throw new Error("Not authenticated");

  const household = await getCurrentHousehold();
  if (!household) throw new Error("No household for current user");

  return { user, household };
}

export interface HouseholdMemberView {
  userId: string;
  role: HouseholdRole;
  joinedAt: string;
  fullName: string | null;
  email: string | null;
}

/**
 * Members of a household, with display identity. Reads entirely under RLS with
 * the regular server client: the membership rows are visible only for the
 * caller's households, and co-member profiles are now readable via the
 * household-scoped SELECT policy added in migration 0002 (the embedded
 * `profiles` join respects that policy). No service-role client needed.
 */
export async function getHouseholdMembers(
  householdId: string
): Promise<HouseholdMemberView[]> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("household_members")
    .select("user_id, role, joined_at, profiles(full_name, email)")
    .eq("household_id", householdId)
    .order("joined_at", { ascending: true });

  if (error || !rows) {
    if (error) console.error("[household] failed to load members", error);
    return [];
  }

  return rows.map((r) => {
    // user_id → profiles is a to-one FK, so PostgREST embeds a single object.
    // (The untyped client infers an array, so normalize defensively.)
    const raw = r.profiles as unknown;
    const profile = (Array.isArray(raw) ? raw[0] : raw) as
      | { full_name: string | null; email: string | null }
      | null
      | undefined;
    return {
      userId: r.user_id as string,
      role: r.role as HouseholdRole,
      joinedAt: r.joined_at as string,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? null,
    };
  });
}
