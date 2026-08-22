// server-only: uses TURNSTILE_SECRET_KEY.
import "server-only";

/**
 * Cloudflare Turnstile verification.
 *
 * TODO(turnstile): flip TURNSTILE_ENABLED to true once the widget is wired into
 * the auth forms and TURNSTILE_SECRET_KEY is set in every environment. Until
 * then this returns { success: true } so flows aren't blocked — the honeypot
 * and time-based bot checks on the auth forms still apply in the meantime.
 */
const TURNSTILE_ENABLED = false;

const VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  success: boolean;
}

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string
): Promise<TurnstileResult> {
  if (!TURNSTILE_ENABLED) {
    return { success: true };
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("[turnstile] TURNSTILE_SECRET_KEY is not set.");
    return { success: false };
  }
  if (!token) {
    return { success: false };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch(VERIFY_URL, { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return { success: data.success === true };
  } catch (err) {
    console.error("[turnstile] verification threw", err);
    return { success: false };
  }
}
