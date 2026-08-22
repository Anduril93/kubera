import { z } from "zod";

/**
 * Budget validation. Pure module (no server-only imports). The amount is entered
 * in DOLLARS as a string and converted to positive integer cents in the server
 * action via parseAmountInput.
 */
export const BUDGET_PERIODS = ["weekly", "monthly"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

const budgetBase = {
  category_id: z.string().uuid("Pick a category"),
  period: z.enum(BUDGET_PERIODS),
  amount: z.string().trim().min(1, "Enter an amount"),
  rollover: z.boolean().optional(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
    .optional(),
};

export const budgetCreateSchema = z.object(budgetBase);
export const budgetUpdateSchema = z.object({
  id: z.string().uuid(),
  ...budgetBase,
});

export type BudgetCreateInput = z.infer<typeof budgetCreateSchema>;
export type BudgetUpdateInput = z.infer<typeof budgetUpdateSchema>;

export type BudgetFormState = {
  error?: string;
  success?: boolean;
};
