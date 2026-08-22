import { z } from "zod";

/**
 * Household form validation. Pure module (no server-only imports) so client
 * forms can share the schemas/types.
 */

export const createHouseholdSchema = z.object({
  name: z.string().trim().min(1, "Enter a household name").max(60, "Name is too long"),
});

export const renameHouseholdSchema = createHouseholdSchema;

export const joinHouseholdSchema = z.object({
  invite_code: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().min(4, "Enter the invite code")),
});

export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;
export type JoinHouseholdInput = z.infer<typeof joinHouseholdSchema>;

/** Shared form-action state for the onboarding + household management forms. */
export type HouseholdFormState = {
  error?: string;
  success?: boolean;
};
