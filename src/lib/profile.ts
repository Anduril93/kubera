// server-only: reads the signed-in user's profile preferences.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth-helper";

export interface CurrentProfile {
  default_currency: string;
  locale: string;
  fiscal_month_start_day: number;
}

export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("default_currency, locale, fiscal_month_start_day")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[profile] load failed", error);
    return null;
  }
  return {
    default_currency: (data.default_currency as string) ?? "USD",
    locale: (data.locale as string) ?? "en-US",
    fiscal_month_start_day: (data.fiscal_month_start_day as number) ?? 1,
  };
}
