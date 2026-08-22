"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { checkLoginRateLimit } from "@/lib/rate-limit-ip";
import { getSafeRedirect } from "@/lib/safe-redirect";
import {
  loginSchema,
  HONEYPOT_FIELD,
  type LoginFormState,
} from "@/lib/validations/auth";

// Single generic message — never reveal whether an email exists.
const GENERIC_ERROR = "Invalid email or password";

function clientIp(forwardedFor: string | null, realIp: string | null): string {
  // x-forwarded-for may be a comma-separated list; the first entry is the client.
  return (forwardedFor?.split(",")[0] ?? realIp ?? "unknown").trim() || "unknown";
}

/**
 * Login server action (used with useActionState). Signs in via the Supabase
 * server client, which sets the session cookie on the response. On success it
 * redirects to a sanitized ?redirect= target (default /dashboard).
 */
export async function login(
  _prevState: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  // Honeypot: a filled hidden field means a bot. Fail generically.
  const honeypot = formData.get(HONEYPOT_FIELD);
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return { error: GENERIC_ERROR };
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirect: formData.get("redirect") ?? undefined,
  });
  if (!parsed.success) {
    return { error: GENERIC_ERROR };
  }

  // IP rate limit: 5 / 15 min / IP. Counts every attempt, so repeated failures
  // (or floods) trip it.
  const hdrs = await headers();
  const ip = clientIp(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip"));
  const limit = checkLoginRateLimit(ip);
  if (!limit.allowed) {
    return { error: "Too many attempts. Please try again later." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // Log the real reason server-side; return only the generic message.
    console.error("[auth] login failed:", error.message);
    return { error: GENERIC_ERROR };
  }

  const destination = getSafeRedirect(parsed.data.redirect, "/dashboard");
  redirect(destination);
}

/**
 * Logout server action. Clears the Supabase session and returns to /login.
 * Exported for the app shell (header/nav) to wire into a sign-out control.
 */
export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
