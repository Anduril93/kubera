"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth-helper";
import { getCurrentHousehold } from "@/lib/household";
import { generateInviteCode } from "@/lib/invite-code";
import {
  createHouseholdSchema,
  joinHouseholdSchema,
  renameHouseholdSchema,
  type HouseholdFormState,
} from "@/lib/validations/household";

const UNIQUE_VIOLATION = "23505";

/** Create a household (caller becomes owner) and go to the dashboard. */
export async function createHousehold(
  _prev: HouseholdFormState,
  formData: FormData
): Promise<HouseholdFormState> {
  const parsed = createHouseholdSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  // Generate a unique invite code, retrying on the (very unlikely) collision.
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await supabase.rpc("create_household_with_owner", {
      p_name: parsed.data.name,
      p_invite_code: generateInviteCode(),
    });
    if (!error) {
      redirect("/dashboard");
    }
    if (error.code === UNIQUE_VIOLATION) {
      continue; // collided on invite_code — try a fresh one
    }
    console.error("[household] create failed", error);
    lastError = "Could not create the household. Please try again.";
    break;
  }
  return { error: lastError ?? "Could not create the household. Please try again." };
}

/** Join an existing household using its invite code, then go to the dashboard. */
export async function joinHousehold(
  _prev: HouseholdFormState,
  formData: FormData
): Promise<HouseholdFormState> {
  const parsed = joinHouseholdSchema.safeParse({
    invite_code: formData.get("invite_code"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid invite code" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("join_household_by_invite", {
    p_invite_code: parsed.data.invite_code,
  });
  if (error) {
    console.error("[household] join failed", error);
    return { error: "That invite code didn't match a household." };
  }

  redirect("/dashboard");
}

/** Owner-only: rename the household. RLS also enforces owner-only. */
export async function renameHousehold(
  _prev: HouseholdFormState,
  formData: FormData
): Promise<HouseholdFormState> {
  const user = await getAuthUser();
  const household = await getCurrentHousehold();
  if (!user || !household) return { error: "Not authenticated" };
  if (household.owner_id !== user.id) {
    return { error: "Only the household owner can rename it." };
  }

  const parsed = renameHouseholdSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("households")
    .update({ name: parsed.data.name })
    .eq("id", household.id);
  if (error) {
    console.error("[household] rename failed", error);
    return { error: "Could not rename the household." };
  }

  revalidatePath("/household");
  return { success: true };
}

/** Owner-only: regenerate the invite code. RLS also enforces owner-only. */
export async function regenerateInviteCode(
  _prev: HouseholdFormState,
  formData: FormData
): Promise<HouseholdFormState> {
  void formData; // signature required by useActionState; no fields needed
  const user = await getAuthUser();
  const household = await getCurrentHousehold();
  if (!user || !household) return { error: "Not authenticated" };
  if (household.owner_id !== user.id) {
    return { error: "Only the household owner can regenerate the code." };
  }

  const supabase = await createClient();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await supabase
      .from("households")
      .update({ invite_code: generateInviteCode() })
      .eq("id", household.id);
    if (!error) {
      revalidatePath("/household");
      return { success: true };
    }
    if (error.code === UNIQUE_VIOLATION) continue;
    console.error("[household] regenerate failed", error);
    break;
  }
  return { error: "Could not regenerate the invite code." };
}
