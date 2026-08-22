// server-only: reads the auth session via the server Supabase client.
import "server-only";

import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Returns the authenticated user for the current request, or null.
 * Use in Server Actions / Route Handlers to derive identity from the session —
 * never trust a client-supplied user id.
 */
export async function getAuthUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Like getAuthUser() but throws when unauthenticated — for guard-first actions. */
export async function requireAuthUser(): Promise<User> {
  const user = await getAuthUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}
