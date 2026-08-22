import { z } from "zod";

/**
 * Category validation. Pure module (no server-only imports). Only CUSTOM
 * household categories are written here; system defaults (household_id IS NULL)
 * are seeded in migration 0003 and are read-only.
 */
export const CATEGORY_KINDS = ["income", "expense", "transfer"] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];

const categoryBase = {
  name: z.string().trim().min(1, "Enter a category name").max(60, "Name is too long"),
  kind: z.enum(CATEGORY_KINDS),
  parent_id: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((v) => v ?? null),
  icon: z.string().trim().min(1).max(40).default("Tag"),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #64748b")
    .default("#64748b"),
};

export const categoryCreateSchema = z.object(categoryBase);

export const categoryUpdateSchema = z.object({
  id: z.string().uuid(),
  ...categoryBase,
});

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

export type CategoryFormState = {
  error?: string;
  success?: boolean;
};
