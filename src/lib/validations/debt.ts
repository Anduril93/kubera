import { z } from "zod";

/**
 * Debt validation. Pure module (no server-only imports). Money fields are
 * entered in DOLLARS as strings → integer cents in the action. APR is a
 * PERCENTAGE (e.g. 18.99), validated 0–100, never cents.
 */
export const DEBT_TYPES = [
  "credit_card",
  "student_loan",
  "mortgage",
  "auto",
  "personal",
  "other",
] as const;
export type DebtType = (typeof DEBT_TYPES)[number];

/** Sentinel for the "not linked / manual balance" option. */
export const DEBT_MANUAL = "manual";

const aprField = z
  .string()
  .optional()
  .refine(
    (v) => {
      if (v == null || v.trim() === "") return true;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    },
    { message: "APR must be between 0 and 100" }
  );

const dueDayField = z
  .string()
  .optional()
  .refine(
    (v) => {
      if (v == null || v.trim() === "") return true;
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 31;
    },
    { message: "Due day must be between 1 and 31" }
  );

const debtBase = {
  name: z.string().trim().min(1, "Enter a name").max(80, "Name is too long"),
  type: z.enum(DEBT_TYPES),
  // Manual balance (principal); ignored when linked to an account.
  balance: z.string().trim().optional(),
  apr: aprField,
  minimum_payment: z.string().trim().optional(),
  due_day: dueDayField,
  // "manual" or an account uuid.
  linked_account_id: z.string().optional(),
};

export const debtCreateSchema = z.object(debtBase);
export const debtUpdateSchema = z.object({
  id: z.string().uuid(),
  ...debtBase,
});

export const debtFormSchema = z.object(debtBase);
export type DebtFormValues = z.infer<typeof debtFormSchema>;
export type DebtCreateInput = z.infer<typeof debtCreateSchema>;
export type DebtUpdateInput = z.infer<typeof debtUpdateSchema>;

export type DebtFormState = {
  error?: string;
  success?: boolean;
};
