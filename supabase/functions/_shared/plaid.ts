// Plaid REST client + item sync shared by the `plaid` and `plaid-webhook`
// Edge Functions. Credentials come from Edge Function secrets (PLAID_CLIENT_ID,
// PLAID_SECRET, PLAID_ENV); access tokens come from Vault via service-role RPCs
// and never leave this process.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@^2.108.2";

export const PLAID_ENV = Deno.env.get("PLAID_ENV") === "production" ? "production" : "sandbox";
const BASE_URL = `https://${PLAID_ENV}.plaid.com`;

export const WEBHOOK_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/plaid-webhook`;

export class PlaidError extends Error {
  constructor(
    readonly code: string,
    readonly type: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// deno-lint-ignore no-explicit-any
export async function plaid<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Plaid-Version": "2020-09-14" },
    body: JSON.stringify({
      client_id: Deno.env.get("PLAID_CLIENT_ID"),
      secret: Deno.env.get("PLAID_SECRET"),
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new PlaidError(json.error_code ?? "UNKNOWN", json.error_type ?? "UNKNOWN", json.error_message ?? "Plaid error", res.status);
  }
  return json as T;
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Errors that mean the household has to reconnect through Link (update mode). */
const RELINK_CODES = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT", "INVALID_CREDENTIALS"]);

export type SyncSummary = { added: number; matched: number; modified: number; removed: number; status: string };

/**
 * Pulls every page of /transactions/sync for one item and applies it in a
 * single database transaction (plaid_apply_sync). Restarts pagination from the
 * saved cursor if Plaid reports the data changed mid-way, as Plaid requires.
 */
export async function syncItem(admin: SupabaseClient, itemId: string): Promise<SyncSummary> {
  const { data: token, error: tokenError } = await admin.rpc("plaid_get_access_token", { p_item: itemId });
  if (tokenError || !token) throw new Error(`[plaid] no access token for item ${itemId}`);

  const { data: row } = await admin.from("plaid_items").select("cursor").eq("id", itemId).single();
  const startCursor: string | null = row?.cursor ?? null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const added: unknown[] = [];
    const modified: unknown[] = [];
    const removed: unknown[] = [];
    let accounts: unknown[] = [];
    let cursor = startCursor;
    let hasMore = true;
    try {
      while (hasMore) {
        const page = await plaid("/transactions/sync", {
          access_token: token,
          cursor: cursor ?? undefined,
          count: 500,
          options: { include_personal_finance_category: true },
        });
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed);
        accounts = page.accounts ?? accounts;
        cursor = page.next_cursor;
        hasMore = page.has_more;
      }
    } catch (err) {
      if (err instanceof PlaidError && err.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") continue;
      if (err instanceof PlaidError && RELINK_CODES.has(err.code)) {
        await admin.rpc("plaid_set_item_status", { p_item: itemId, p_status: "login_required", p_error_code: err.code });
        return { added: 0, matched: 0, modified: 0, removed: 0, status: "login_required" };
      }
      if (err instanceof PlaidError) {
        await admin.rpc("plaid_set_item_status", { p_item: itemId, p_status: "error", p_error_code: err.code });
      }
      throw err;
    }

    const { data: summary, error } = await admin.rpc("plaid_apply_sync", {
      p_item: itemId,
      p_added: added,
      p_modified: modified,
      p_removed: removed,
      p_accounts: accounts,
      p_next_cursor: cursor,
    });
    if (error) throw new Error(`[plaid] apply sync failed: ${error.message}`);
    return { ...(summary as Omit<SyncSummary, "status">), status: "active" };
  }
  throw new Error("[plaid] transactions kept changing during pagination");
}
