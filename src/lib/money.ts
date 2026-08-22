/**
 * Money helpers. ALL monetary values in this app are stored and passed around
 * as integer cents (bigint in the DB, number in JS). Convert/format only at the
 * display edge. Pure module — safe to import on client and server.
 */

/** Convert a dollar amount (e.g. 12.34) to integer cents (1234). */
export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new Error("dollarsToCents: amount must be a finite number");
  }
  // Round to avoid binary-float drift (e.g. 12.34 * 100 = 1233.9999...).
  return Math.round(dollars * 100);
}

/** Convert integer cents (1234) to a dollar amount (12.34). */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

export interface ParseAmountOptions {
  /** Allow a negative result. Defaults to false (most inputs are positive). */
  allowNegative?: boolean;
}

/**
 * Parse a user-typed amount string into integer cents.
 * Strips currency symbols, spaces, and thousands separators. Throws on empty,
 * NaN, or (by default) negative input — callers should surface a friendly
 * message or pair this with a Zod schema.
 */
export function parseAmountInput(
  input: string,
  options: ParseAmountOptions = {}
): number {
  const { allowNegative = false } = options;

  if (typeof input !== "string") {
    throw new Error("Amount must be a string");
  }

  const trimmed = input.trim();
  if (trimmed === "") {
    throw new Error("Amount is required");
  }

  // Keep digits, a single sign, and the decimal point; drop $, commas, spaces.
  const negative = /^\s*-/.test(trimmed);
  const cleaned = trimmed.replace(/[^0-9.]/g, "");
  const value = Number(cleaned) * (negative ? -1 : 1);

  if (!Number.isFinite(value)) {
    throw new Error("Amount is not a valid number");
  }
  if (!allowNegative && value < 0) {
    throw new Error("Amount must not be negative");
  }

  return dollarsToCents(value);
}

/**
 * Format integer cents as a localized currency string.
 * Defaults to USD / en-US; pass the household's currency + locale at call time.
 */
export function formatCurrency(
  cents: number,
  currency = "USD",
  locale = "en-US"
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(centsToDollars(cents));
}
