// `server-only` makes this module a BUILD ERROR if it is ever imported into a
// Client Component or any client bundle. The service-role key must never reach
// the browser (CLAUDE.md › Security Rules).
import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — BYPASSES Row Level Security.
 *
 * Use ONLY in trusted server contexts where RLS cannot apply (e.g. Plaid
 * webhook handlers, reading the Plaid access token from Vault). Never expose
 * the result, the key, or any privileged data to the client. Prefer the
 * household-scoped server client (`server.ts`) everywhere else.
 */
export function createServiceClient() {
  // Defense in depth: even if `server-only` is somehow tree-shaken away, refuse
  // to run in a browser environment.
  if (typeof window !== "undefined") {
    throw new Error(
      "createServiceClient() must never be called in the browser."
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
