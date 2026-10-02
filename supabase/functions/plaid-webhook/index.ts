// plaid-webhook — Plaid → us. Deployed with --no-verify-jwt (Plaid can't send a
// Supabase JWT), so every request is authenticated by verifying Plaid's own
// signed JWT in the Plaid-Verification header and the body hash it carries.
import { decodeProtectedHeader, importJWK, type JWK, jwtVerify } from "npm:jose@^5.9.6";
import { adminClient, plaid, syncItem } from "../_shared/plaid.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const keyCache = new Map<string, JWK>();

async function verificationKey(kid: string): Promise<JWK | null> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  const res = await plaid("/webhook_verification_key/get", { key_id: kid });
  const key = res.key as JWK & { expired_at?: number | null };
  if (key.expired_at) return null;
  keyCache.set(kid, key);
  return key;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verify(req: Request, rawBody: string): Promise<boolean> {
  const token = req.headers.get("Plaid-Verification");
  if (!token) return false;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "ES256" || !header.kid) return false;
    const jwk = await verificationKey(header.kid);
    if (!jwk) return false;
    const { payload } = await jwtVerify(token, await importJWK(jwk, "ES256"), { maxTokenAge: "5 min" });
    const expected = String(payload.request_body_sha256 ?? "");
    return timingSafeEqual(expected, await sha256Hex(rawBody));
  } catch (err) {
    console.error("[plaid-webhook] verification failed", err);
    return false;
  }
}

async function handle(event: Record<string, unknown>) {
  const admin = adminClient();
  const { data: item } = await admin.from("plaid_items").select("id").eq("item_id", String(event.item_id ?? "")).maybeSingle();
  if (!item) {
    console.error("[plaid-webhook] unknown item", event.item_id);
    return;
  }
  const type = event.webhook_type;
  const code = event.webhook_code;

  if (type === "TRANSACTIONS" && (code === "SYNC_UPDATES_AVAILABLE" || code === "INITIAL_UPDATE" || code === "HISTORICAL_UPDATE" || code === "DEFAULT_UPDATE")) {
    const summary = await syncItem(admin, item.id);
    console.log("[plaid-webhook] synced", item.id, JSON.stringify(summary));
    return;
  }
  if (type === "ITEM") {
    if (code === "ERROR") {
      const errorCode = (event.error as { error_code?: string } | null)?.error_code ?? "ERROR";
      await admin.rpc("plaid_set_item_status", {
        p_item: item.id,
        p_status: errorCode === "ITEM_LOGIN_REQUIRED" ? "login_required" : "error",
        p_error_code: errorCode,
      });
    } else if (code === "PENDING_EXPIRATION" || code === "PENDING_DISCONNECT") {
      await admin.rpc("plaid_set_item_status", { p_item: item.id, p_status: "login_required", p_error_code: code });
    } else if (code === "LOGIN_REPAIRED") {
      await admin.rpc("plaid_set_item_status", { p_item: item.id, p_status: "active", p_error_code: null });
    } else if (code === "USER_PERMISSION_REVOKED" || code === "USER_ACCOUNT_REVOKED") {
      await admin.rpc("plaid_set_item_status", { p_item: item.id, p_status: "error", p_error_code: code });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const rawBody = await req.text();
  if (!(await verify(req, rawBody))) return new Response("Unauthorized", { status: 401 });

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Acknowledge fast; Plaid retries on slow or failed deliveries.
  const work = handle(event).catch((err) => console.error("[plaid-webhook] handler failed", err));
  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(work);
  } else {
    await work;
  }
  return new Response("ok");
});
