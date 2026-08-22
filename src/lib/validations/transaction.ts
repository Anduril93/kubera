import { z } from "zod";

/**
 * Transaction validation. Pure module (no server-only imports). The amount is
 * entered in DOLLARS as a string and converted to integer cents in the server
 * action via parseAmountInput (sign is carried by `type`, so the amount is a
 * positive magnitude).
 */
export const TRANSACTION_TYPES = ["income", "expense", "transfer"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const transactionBase = {
  account_id: z.string().uuid(),
  category_id: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((v) => v ?? null),
  type: z.enum(TRANSACTION_TYPES),
  // Dollars, as typed; converted to positive integer cents in the action.
  amount: z.string().trim().min(1, "Enter an amount"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
  merchant: optionalText(120),
  description: optionalText(200),
  notes: optionalText(1000),
  pending: z.coerce.boolean().optional(),
};

export const transactionSchema = z.object(transactionBase);

export const transactionUpdateSchema = z.object({
  id: z.string().uuid(),
  ...transactionBase,
});

export type TransactionInput = z.infer<typeof transactionSchema>;
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;

/**
 * Split validation. Operates on already-converted integer cents so the sum rule
 * is exact. The child amounts MUST sum exactly to the parent amount, else the
 * split is rejected.
 */
export const splitChildInputSchema = z.object({
  category_id: z.string().uuid().nullable(),
  amount_cents: z.number().int().positive("Each part must be greater than zero"),
  description: z.string().trim().max(200).nullable().optional(),
});

export const splitInputSchema = z
  .object({
    parent_amount_cents: z.number().int(),
    children: z
      .array(splitChildInputSchema)
      .min(2, "A split needs at least two parts"),
  })
  .superRefine((val, ctx) => {
    const sum = val.children.reduce((s, c) => s + c.amount_cents, 0);
    if (sum !== val.parent_amount_cents) {
      ctx.addIssue({
        code: "custom",
        path: ["children"],
        message: `Split parts must sum to the transaction total (${sum} ≠ ${val.parent_amount_cents} cents).`,
      });
    }
  });

export type SplitInput = z.infer<typeof splitInputSchema>;

export type TransactionFormState = {
  error?: string;
  success?: boolean;
};

/**
 * Client form shape (all strings) for react-hook-form + form.tsx. The server
 * actions re-validate authoritatively. `category_id` may be "" / "none" (no
 * category) — the dialog omits it from the payload in that case.
 */
export const transactionFormSchema = z.object({
  account_id: z.string().uuid("Pick an account"),
  category_id: z.string().optional(),
  type: z.enum(TRANSACTION_TYPES),
  amount: z.string().trim().min(1, "Enter an amount"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  merchant: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  pending: z.boolean().optional(),
});

export type TransactionFormValues = z.infer<typeof transactionFormSchema>;
