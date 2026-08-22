import { z } from "zod";

/**
 * Account validation. Pure module (no server-only imports). The starting/edited
 * balance is entered in DOLLARS as a string and converted to integer cents in
 * the server action via parseAmountInput — never trust a client-supplied number.
 */
export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "credit_card",
  "cash",
  "investment",
  "loan",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

const institution = z
  .string()
  .trim()
  .max(120, "Institution name is too long")
  .optional()
  .transform((v) => (v ? v : null));

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, "Use a 3-letter currency code")
  .default("USD");

const accountBase = {
  name: z.string().trim().min(1, "Enter an account name").max(80, "Name is too long"),
  type: z.enum(ACCOUNT_TYPES),
  institution,
  currency,
};

export const accountCreateSchema = z.object({
  ...accountBase,
  // Optional at the schema level; the action defaults missing/empty to 0 cents.
  starting_balance: z.string().optional(),
});

export const accountUpdateSchema = z.object({
  id: z.string().uuid(),
  ...accountBase,
  // When present, replaces the current balance (manual accounts).
  balance: z.string().optional(),
});

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;

export type AccountFormState = {
  error?: string;
  success?: boolean;
};

/**
 * Client-side form shape (all strings) for react-hook-form + the hand-authored
 * form.tsx. The server actions re-validate authoritatively with the schemas
 * above; this is for in-dialog UX validation.
 */
export const accountFormSchema = z.object({
  name: z.string().trim().min(1, "Enter an account name").max(80, "Name is too long"),
  type: z.enum(ACCOUNT_TYPES),
  institution: z.string().trim().max(120, "Institution name is too long").optional(),
  // Dollars, as typed. Optional; empty means 0 on create / unchanged on edit.
  balance: z.string().trim().optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, "Use a 3-letter currency code"),
});

export type AccountFormValues = z.infer<typeof accountFormSchema>;
