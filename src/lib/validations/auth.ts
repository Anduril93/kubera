import { z } from "zod";

/**
 * Login form validation. Accounts are provisioned directly in Supabase by an
 * admin — there is no registration schema, no email confirmation. Pure module
 * (no server-only imports) so the client form can share the types.
 */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  // Don't enforce password complexity on login — only on account creation
  // (which happens in Supabase, not here). Just require something present.
  password: z.string().min(1, "Password is required"),
  // Optional sanitized post-login destination (see getSafeRedirect()).
  redirect: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Name of the hidden honeypot field — must stay empty for real users. */
export const HONEYPOT_FIELD = "company";

/** Returned by the login server action to the form via useActionState. */
export type LoginFormState = {
  error?: string;
};
