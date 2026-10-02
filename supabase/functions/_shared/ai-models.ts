/**
 * SINGLE source of truth for Anthropic model strings used by Edge Functions.
 * Never hardcode a model id at a call site — import from here.
 *
 * If an AI feature suddenly starts returning a 404 / "model not found", the
 * model string below has been retired. Update it HERE and redeploy.
 *
 * Tier guidance (see CLAUDE.md › AI Integration):
 *   sonnet — receipt scan, statement/CSV import, monthly insights, assistant
 *   haiku  — auto-categorization (cheap, high-volume; cached per merchant)
 */
export const AI_MODELS = {
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-4-5",
} as const;
