"use server";

import Anthropic from "@anthropic-ai/sdk";

import { AI_MODELS } from "@/lib/ai-models";
import { checkAIRateLimit } from "@/lib/rate-limit";
import { getCurrentHousehold } from "@/lib/household";
import { getCategories } from "@/lib/categories-data";
import { getR2Object, isR2Configured, R2NotConfiguredError } from "@/lib/r2";
import { detectFileType } from "@/lib/file-validation";
import type { ReceiptDraft, ScanReceiptResult } from "@/lib/types/ai";

const FEATURE = "receipt_scan";
const MAX_KEYS = 8;

const SYSTEM_PROMPT =
  "You extract structured data from receipt images/PDFs for a personal finance " +
  "app. Read the merchant, the date, and the grand total (the final amount paid, " +
  "including tax/tip — not a subtotal). Suggest the single best-matching category " +
  "id from the provided list, or null if none fit. If a field isn't legible, use " +
  "null rather than guessing. Always call the record_receipt tool.";

const RECORD_TOOL: Anthropic.Tool = {
  name: "record_receipt",
  description: "Record the fields extracted from the receipt.",
  input_schema: {
    type: "object",
    properties: {
      merchant: { type: ["string", "null"], description: "Merchant / store name" },
      date: {
        type: ["string", "null"],
        description: "Transaction date as yyyy-mm-dd",
      },
      total_amount: {
        type: ["number", "null"],
        description: "Grand total actually paid, as a decimal number (e.g. 42.17)",
      },
      category_id: {
        type: ["string", "null"],
        description: "id of the best-matching category from the provided list, or null",
      },
      currency: {
        type: ["string", "null"],
        description: "ISO 4217 currency code if shown (e.g. USD)",
      },
    },
    required: ["merchant", "date", "total_amount", "category_id"],
  },
};

function isYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Scan one or more receipt images/PDFs (already uploaded to R2, passed as keys)
 * and return a structured draft. Never creates a transaction — the user reviews
 * and confirms. Rate-limited per user/day; every failure returns a clear message
 * so the UI can fall back to manual entry.
 */
export async function scanReceipt(keys: string[]): Promise<ScanReceiptResult> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "Not signed in.", errorKind: "unavailable" };

  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEYS) {
    return { error: "No receipt to scan.", errorKind: "unreadable" };
  }
  // Only accept keys within this household's namespace.
  const prefix = `receipts/${household.id}/`;
  if (!keys.every((k) => typeof k === "string" && k.startsWith(prefix))) {
    return { error: "That receipt isn't available.", errorKind: "unreadable" };
  }

  // Rate limit FIRST (before any AI/storage work). Fail-closed helper.
  const limit = await checkAIRateLimit(FEATURE);
  if (!limit.allowed) {
    return {
      error: "You've reached today's receipt-scan limit. Enter it manually.",
      errorKind: "rate_limit",
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !isR2Configured()) {
    return {
      error: "Receipt scanning isn't available right now. Enter it manually.",
      errorKind: "unavailable",
    };
  }

  // Load the files from R2 and build Claude content blocks.
  const blocks: Anthropic.ContentBlockParam[] = [];
  try {
    for (const key of keys) {
      const { bytes } = await getR2Object(key);
      const detected = detectFileType(bytes);
      if (!detected) continue;
      const data = Buffer.from(bytes).toString("base64");
      if (detected.kind === "pdf") {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data },
        });
      } else {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: detected.mime as
              | "image/jpeg"
              | "image/png"
              | "image/webp",
            data,
          },
        });
      }
    }
  } catch (err) {
    if (err instanceof R2NotConfiguredError) {
      return {
        error: "Receipt scanning isn't available right now. Enter it manually.",
        errorKind: "unavailable",
      };
    }
    console.error("[receipt-scan] load failed", err);
    return { error: "Couldn't read the receipt. Enter it manually.", errorKind: "unreadable" };
  }
  if (blocks.length === 0) {
    return { error: "Couldn't read the receipt. Enter it manually.", errorKind: "unreadable" };
  }

  // Category options (expenses) the model may choose from.
  const categories = (await getCategories()).filter((c) => c.kind === "expense");
  const categoryList = categories
    .map((c) => `${c.id}: ${c.name}`)
    .join("\n");
  const visibleIds = new Set(categories.map((c) => c.id));

  const client = new Anthropic({ apiKey });
  let toolInput: Record<string, unknown> | null = null;
  try {
    const message = await client.messages.create({
      model: AI_MODELS.sonnet,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [RECORD_TOOL],
      tool_choice: { type: "tool", name: "record_receipt" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Extract the receipt details. Choose category_id from this list ` +
                `(or null):\n${categoryList || "(no categories)"}`,
            },
            ...blocks,
          ],
        },
      ],
    });
    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (toolUse) toolInput = toolUse.input as Record<string, unknown>;
  } catch (err) {
    console.error("[receipt-scan] AI call failed", err);
    return { error: "Couldn't read the receipt. Enter it manually.", errorKind: "unreadable" };
  }

  if (!toolInput) {
    return { error: "The scan came back unreadable. Enter it manually.", errorKind: "malformed" };
  }

  try {
    const rawTotal = toolInput.total_amount;
    const amountCents =
      typeof rawTotal === "number" && Number.isFinite(rawTotal) && rawTotal >= 0
        ? Math.round(rawTotal * 100)
        : null;
    const categoryId =
      typeof toolInput.category_id === "string" &&
      visibleIds.has(toolInput.category_id)
        ? toolInput.category_id
        : null;

    const draft: ReceiptDraft = {
      merchant:
        typeof toolInput.merchant === "string" && toolInput.merchant.trim()
          ? toolInput.merchant.trim().slice(0, 120)
          : null,
      date: isYmd(toolInput.date) ? toolInput.date : null,
      amountCents,
      categoryId,
      currency:
        typeof toolInput.currency === "string" && toolInput.currency.length === 3
          ? toolInput.currency.toUpperCase()
          : "USD",
    };
    return { draft };
  } catch (err) {
    console.error("[receipt-scan] parse failed", err);
    return { error: "The scan came back unreadable. Enter it manually.", errorKind: "malformed" };
  }
}
