// scan-receipt — AI receipt extraction for the native app.
//
// POST { paths: string[] }  (object paths inside the private `receipts`
// bucket, each "<household_id>/<uuid>.<ext>")
//   200 { draft: ReceiptDraft }
//   4xx/5xx { error: string, errorKind: "rate_limit" | "unavailable" | "unreadable" | "malformed" }
//
// Everything runs as the CALLER (their JWT is forwarded to Supabase), so RLS
// scopes the storage download, the category list, and the rate-limit counter.
// The draft is never saved — the app shows it in the transaction form for the
// user to confirm. Port of src/lib/ai/receipt-scan.ts.
import Anthropic from "npm:@anthropic-ai/sdk@^0.120.0";
import { createClient } from "npm:@supabase/supabase-js@^2.108.2";
import { encodeBase64 } from "jsr:@std/encoding@^1/base64";
import { AI_MODELS } from "../_shared/ai-models.ts";
import { detectFileType } from "../_shared/file-type.ts";

const MAX_FILES = 8;
const DAILY_AI_LIMIT = 50;

type ErrorKind = "rate_limit" | "unavailable" | "unreadable" | "malformed";

type ReceiptDraft = {
  merchant: string | null;
  date: string | null;
  amountCents: number | null;
  categoryId: string | null;
  currency: string;
};

const SYSTEM_PROMPT =
  "You extract structured data from receipt images/PDFs for a personal finance app. " +
  "Read the merchant, the date, and the grand total (the final amount paid, including tax/tip — not a subtotal). " +
  "Suggest the single best-matching category id from the provided list, or null if none fit. " +
  "If a field isn't legible, use null rather than guessing.";

const nullable = (type: "string" | "number", description: string) => ({
  anyOf: [{ type }, { type: "null" }],
  description,
});

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    merchant: nullable("string", "Merchant / store name"),
    date: nullable("string", "Transaction date as yyyy-mm-dd"),
    total_amount: nullable("number", "Grand total actually paid, as a decimal number (e.g. 42.17)"),
    category_id: nullable("string", "id of the best-matching category from the provided list, or null"),
    currency: nullable("string", "ISO 4217 currency code if shown (e.g. USD)"),
  },
  required: ["merchant", "date", "total_amount", "category_id", "currency"],
  additionalProperties: false,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(error: string, errorKind: ErrorKind, status: number): Response {
  return json({ error, errorKind }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fail("Not signed in.", "unavailable", 401);

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const householdId: string | undefined = membership?.household_id;
  if (!householdId) return fail("Not signed in.", "unavailable", 401);

  let paths: unknown;
  try {
    paths = (await req.json())?.paths;
  } catch {
    paths = null;
  }
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_FILES) {
    return fail("No receipt to scan.", "unreadable", 400);
  }
  const pathPattern = new RegExp(`^${householdId}/[A-Za-z0-9_-]+\\.(jpg|png|webp|pdf)$`);
  if (!paths.every((p) => typeof p === "string" && pathPattern.test(p))) {
    return fail("That receipt isn't available.", "unreadable", 400);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("[scan-receipt] ANTHROPIC_API_KEY is not set");
    return fail("Receipt scanning isn't available right now. Enter it manually.", "unavailable", 503);
  }

  // Counts before the AI call, so failed scans still count (same as the web app).
  const { data: used, error: limitError } = await supabase.rpc("check_ai_rate_limit", {
    p_user_id: user.id,
    p_feature: "receipt_scan",
    p_limit: DAILY_AI_LIMIT,
  });
  if (limitError || used == null) {
    console.error("[scan-receipt] rate limit check failed", limitError);
    return fail("Receipt scanning isn't available right now. Enter it manually.", "unavailable", 503);
  }
  if (Number(used) > DAILY_AI_LIMIT) {
    return fail("You've reached today's receipt-scan limit. Enter it manually.", "rate_limit", 429);
  }

  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const path of paths as string[]) {
    const { data: blob, error } = await supabase.storage.from("receipts").download(path);
    if (error || !blob) {
      console.error("[scan-receipt] download failed", path, error);
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const detected = detectFileType(bytes);
    if (!detected) continue;
    const data = encodeBase64(bytes);
    blocks.push(
      detected.mime === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: detected.mime, data } },
    );
  }
  if (blocks.length === 0) return fail("Couldn't read the receipt. Enter it manually.", "unreadable", 400);

  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .eq("kind", "expense")
    .eq("is_archived", false)
    .order("name", { ascending: true });
  const visibleIds = new Set((categories ?? []).map((c) => c.id as string));
  const categoryList = (categories ?? []).map((c) => `${c.id}: ${c.name}`).join("\n");

  const client = new Anthropic({ apiKey });
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: AI_MODELS.sonnet,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: RECEIPT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            ...blocks,
            {
              type: "text",
              text: `Extract the receipt details. Choose category_id from this list (or null):\n${categoryList || "(no categories)"}`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error(`[scan-receipt] Anthropic API error ${err.status}`, err.message);
    } else {
      console.error("[scan-receipt] Anthropic request failed", err);
    }
    return fail("Couldn't read the receipt. Enter it manually.", "unreadable", 502);
  }

  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    console.error("[scan-receipt] unusable stop_reason", response.stop_reason);
    return fail("The scan came back unreadable. Enter it manually.", "malformed", 502);
  }

  let fields: Record<string, unknown>;
  try {
    const text = response.content.find((b) => b.type === "text");
    fields = JSON.parse(text && "text" in text ? text.text : "");
  } catch {
    return fail("The scan came back unreadable. Enter it manually.", "malformed", 502);
  }

  const total = fields.total_amount;
  const merchant = typeof fields.merchant === "string" ? fields.merchant.trim().slice(0, 120) : "";
  const date = typeof fields.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fields.date) ? fields.date : null;
  const categoryId =
    typeof fields.category_id === "string" && visibleIds.has(fields.category_id) ? fields.category_id : null;
  const currency =
    typeof fields.currency === "string" && fields.currency.trim().length === 3
      ? fields.currency.trim().toUpperCase()
      : "USD";

  const draft: ReceiptDraft = {
    merchant: merchant || null,
    date,
    amountCents: typeof total === "number" && Number.isFinite(total) && total >= 0 ? Math.round(total * 100) : null,
    categoryId,
    currency,
  };
  return json({ draft });
});
