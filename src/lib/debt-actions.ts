"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentHousehold } from "@/lib/household";
import { parseAmountInput } from "@/lib/money";
import {
  debtCreateSchema,
  debtUpdateSchema,
  DEBT_MANUAL,
  type DebtFormState,
} from "@/lib/validations/debt";

const idSchema = z.string().uuid();

function revalidateDebts() {
  revalidatePath("/debts");
  revalidatePath("/dashboard");
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function accountIsVisible(supabase: ServerClient, id: string) {
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  return !!data;
}

function resolveLink(value: string | undefined): string | null {
  if (!value || value === DEBT_MANUAL) return null;
  return value;
}

/** Build the DB fields shared by create/update from validated form data. */
function toDebtFields(data: {
  name: string;
  type: string;
  balance?: string;
  apr?: string;
  minimum_payment?: string;
  due_day?: string;
  linked_account_id?: string;
}):
  | { ok: true; fields: Record<string, unknown>; linkedAccountId: string | null }
  | { ok: false; error: string } {
  const linkedAccountId = resolveLink(data.linked_account_id);

  // Manual balance (principal); ignored/zero when linked.
  let principalCents = 0;
  if (!linkedAccountId && data.balance && data.balance.trim() !== "") {
    try {
      principalCents = parseAmountInput(data.balance);
    } catch {
      return { ok: false, error: "Enter a valid balance" };
    }
  }

  let minimumPaymentCents: number | null = null;
  if (data.minimum_payment && data.minimum_payment.trim() !== "") {
    try {
      minimumPaymentCents = parseAmountInput(data.minimum_payment);
    } catch {
      return { ok: false, error: "Enter a valid minimum payment" };
    }
  }

  const apr =
    data.apr && data.apr.trim() !== "" ? Number(data.apr) : null;
  const dueDay =
    data.due_day && data.due_day.trim() !== "" ? Number(data.due_day) : null;

  return {
    ok: true,
    linkedAccountId,
    fields: {
      name: data.name,
      type: data.type,
      principal_cents: principalCents,
      apr,
      minimum_payment_cents: minimumPaymentCents,
      due_day: dueDay,
      linked_account_id: linkedAccountId,
    },
  };
}

export async function createDebt(
  _prev: DebtFormState,
  formData: FormData
): Promise<DebtFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = debtCreateSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    balance: formData.get("balance") ?? undefined,
    apr: formData.get("apr") ?? undefined,
    minimum_payment: formData.get("minimum_payment") ?? undefined,
    due_day: formData.get("due_day") ?? undefined,
    linked_account_id: formData.get("linked_account_id") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const built = toDebtFields(parsed.data);
  if (!built.ok) return { error: built.error };

  const supabase = await createClient();
  if (
    built.linkedAccountId &&
    !(await accountIsVisible(supabase, built.linkedAccountId))
  ) {
    return { error: "That account isn't available." };
  }

  const { error } = await supabase.from("debts").insert({
    household_id: household.id,
    ...built.fields,
  });
  if (error) {
    console.error("[debts] create failed", error);
    return { error: "Could not create the debt." };
  }

  revalidateDebts();
  return { success: true };
}

export async function updateDebt(
  _prev: DebtFormState,
  formData: FormData
): Promise<DebtFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsed = debtUpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    type: formData.get("type"),
    balance: formData.get("balance") ?? undefined,
    apr: formData.get("apr") ?? undefined,
    minimum_payment: formData.get("minimum_payment") ?? undefined,
    due_day: formData.get("due_day") ?? undefined,
    linked_account_id: formData.get("linked_account_id") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const built = toDebtFields(parsed.data);
  if (!built.ok) return { error: built.error };

  const supabase = await createClient();
  if (
    built.linkedAccountId &&
    !(await accountIsVisible(supabase, built.linkedAccountId))
  ) {
    return { error: "That account isn't available." };
  }

  const { data, error } = await supabase
    .from("debts")
    .update(built.fields)
    .eq("id", parsed.data.id)
    .eq("household_id", household.id)
    .select("id");
  if (error) {
    console.error("[debts] update failed", error);
    return { error: "Could not update the debt." };
  }
  if (!data || data.length === 0) return { error: "Debt not found." };

  revalidateDebts();
  return { success: true };
}

export async function deleteDebt(
  _prev: DebtFormState,
  formData: FormData
): Promise<DebtFormState> {
  const household = await getCurrentHousehold();
  if (!household) return { error: "No household for current user" };

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) return { error: "Invalid debt" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("debts")
    .delete()
    .eq("id", parsedId.data)
    .eq("household_id", household.id)
    .select("id");
  if (error) {
    console.error("[debts] delete failed", error);
    return { error: "Could not delete the debt." };
  }
  if (!data || data.length === 0) return { error: "Debt not found." };

  revalidateDebts();
  return { success: true };
}
