import { z } from "zod";

/**
 * Recurring-rule validation. Pure module (no server-only imports). Amount is
 * entered in DOLLARS as a string and converted to positive integer cents in the
 * server action via parseAmountInput.
 */
export const RECURRING_TYPES = ["income", "expense"] as const;
export type RecurringType = (typeof RECURRING_TYPES)[number];

export const RECURRING_FREQUENCIES = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

const recurringBase = {
  account_id: z.string().uuid("Pick an account"),
  category_id: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((v) => v ?? null),
  name: z.string().trim().min(1, "Enter a name").max(80, "Name is too long"),
  amount: z.string().trim().min(1, "Enter an amount"),
  type: z.enum(RECURRING_TYPES),
  frequency: z.enum(RECURRING_FREQUENCIES),
  next_due_date: dateStr,
  end_date: dateStr.optional().nullable().transform((v) => v ?? null),
  auto_post: z.boolean().optional(),
};

export const recurringCreateSchema = z.object(recurringBase);
export const recurringUpdateSchema = z.object({
  id: z.string().uuid(),
  ...recurringBase,
});

export type RecurringCreateInput = z.infer<typeof recurringCreateSchema>;
export type RecurringUpdateInput = z.infer<typeof recurringUpdateSchema>;

export type RecurringFormState = {
  error?: string;
  success?: boolean;
  /** postRecurringRule: true when the rule wasn't due, so nothing was posted. */
  notDue?: boolean;
};
