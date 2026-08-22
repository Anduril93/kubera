"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  type CategoryFormState,
} from "@/lib/validations/category";

const idSchema = z.string().uuid();

// System defaults (household_id IS NULL) are read-only: every write here sets or
// matches the caller's household_id, so a NULL-household row is never affected
// (RLS enforces the same).

/** Create a custom category in the caller's household. */
export async function createCategory(
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = categoryCreateSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    parent_id: formData.get("parent_id") ?? undefined,
    icon: formData.get("icon") ?? undefined,
    color: formData.get("color") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("categories").insert({
    household_id: household.id,
    name: parsed.data.name,
    kind: parsed.data.kind,
    parent_id: parsed.data.parent_id,
    icon: parsed.data.icon,
    color: parsed.data.color,
  });
  if (error) {
    console.error("[categories] create failed", error);
    return { error: "Could not create the category." };
  }

  revalidatePath("/transactions");
  revalidatePath("/budgets");
  return { success: true };
}

/** Update a custom category in the caller's household (system defaults excluded). */
export async function updateCategory(
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = categoryUpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    kind: formData.get("kind"),
    parent_id: formData.get("parent_id") ?? undefined,
    icon: formData.get("icon") ?? undefined,
    color: formData.get("color") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update({
      name: parsed.data.name,
      kind: parsed.data.kind,
      parent_id: parsed.data.parent_id,
      icon: parsed.data.icon,
      color: parsed.data.color,
    })
    .eq("id", parsed.data.id)
    .eq("household_id", household.id) // excludes system defaults; RLS too
    .select("id");
  if (error) {
    console.error("[categories] update failed", error);
    return { error: "Could not update the category." };
  }
  if (!data || data.length === 0) {
    return { error: "Category not found or not editable." };
  }

  revalidatePath("/transactions");
  revalidatePath("/budgets");
  return { success: true };
}

/** Archive a custom category in the caller's household (system defaults excluded). */
export async function archiveCategory(
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) return { error: "Invalid category" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update({ is_archived: true })
    .eq("id", parsedId.data)
    .eq("household_id", household.id)
    .select("id");
  if (error) {
    console.error("[categories] archive failed", error);
    return { error: "Could not archive the category." };
  }
  if (!data || data.length === 0) {
    return { error: "Category not found or not editable." };
  }

  revalidatePath("/transactions");
  revalidatePath("/budgets");
  return { success: true };
}
