import { z } from "zod";

/**
 * Savings-goal validation. Pure module (no server-only imports). Amounts are
 * entered in DOLLARS as strings and converted to integer cents in the server
 * actions via parseAmountInput.
 */

/** Sentinel for the "not linked / manual" option in the account picker. */
export const GOAL_MANUAL = "manual";

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

const goalBase = {
  name: z.string().trim().min(1, "Enter a name").max(80, "Name is too long"),
  target_amount: z.string().trim().min(1, "Enter a target amount"),
  target_date: dateStr.optional().or(z.literal("")),
  // "manual" or an account uuid.
  linked_account_id: z.string().optional(),
  // Optional starting amount for a manual goal (create only).
  current_amount: z.string().trim().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
};

export const goalCreateSchema = z.object(goalBase);
export const goalUpdateSchema = z.object({
  id: z.string().uuid(),
  ...goalBase,
});

export type GoalCreateInput = z.infer<typeof goalCreateSchema>;
export type GoalUpdateInput = z.infer<typeof goalUpdateSchema>;

/** react-hook-form values (all strings). */
export const goalFormSchema = z.object(goalBase);
export type GoalFormValues = z.infer<typeof goalFormSchema>;

export const contributionSchema = z.object({
  amount: z.string().trim().min(1, "Enter an amount"),
});

export type GoalFormState = {
  error?: string;
  success?: boolean;
};
