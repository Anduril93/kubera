// server-only: hits the database via the server Supabase client.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth-helper";

/** Default per-user daily cap across AI features. */
export const DAILY_AI_LIMIT = 50;

export interface AIRateLimitResult {
  allowed: boolean;
  /** Calls remaining today after this check. */
  remaining: number;
  limit: number;
}

/**
 * Per-user daily AI usage limiter, backed by a Postgres RPC.
 *
 * The SQL function ships with the AI phase. Expected signature:
 *
 *   check_ai_rate_limit(p_user_id uuid, p_feature text, p_limit int)
 *     returns integer   -- usage count for today AFTER atomically incrementing
 *
 * It should upsert into `ai_usage` (per user/day) and return the new count, so
 * the limit decision is made atomically server-side. We fail CLOSED on any
 * error (no auth, RPC missing/erroring) — better to block an AI call than to
 * let usage run unbounded.
 */
export async function checkAIRateLimit(
  feature: string,
  limit: number = DAILY_AI_LIMIT
): Promise<AIRateLimitResult> {
  const user = await getAuthUser();
  if (!user) return { allowed: false, remaining: 0, limit };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_ai_rate_limit", {
    p_user_id: user.id,
    p_feature: feature,
    p_limit: limit,
  });

  if (error) {
    console.error("[rate-limit] check_ai_rate_limit RPC failed", error);
    return { allowed: false, remaining: 0, limit };
  }

  const used = typeof data === "number" ? data : Number(data ?? limit + 1);
  const remaining = Math.max(0, limit - used);
  return { allowed: used <= limit, remaining, limit };
}
