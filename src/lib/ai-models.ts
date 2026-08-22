/**
 * SINGLE source of truth for Anthropic model strings. Never hardcode a model
 * id at a call site — import from here.
 *
 * ⚠️ If an AI feature suddenly starts returning a 404 / "model not found", the
 * model string below has almost certainly been retired by Anthropic. Update it
 * HERE (and only here) to the current replacement and every feature picks it up.
 *
 * Tier guidance (see CLAUDE.md › AI Integration):
 *   sonnet — receipt scan, statement/CSV import, monthly insights, assistant
 *   haiku  — auto-categorization (cheap, high-volume; cached per merchant)
 */
export const AI_MODELS = {
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
} as const;

export type AiModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];
