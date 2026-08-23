"use client";

import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createDebt, updateDebt } from "@/lib/debt-actions";
import {
  debtFormSchema,
  DEBT_MANUAL,
  DEBT_TYPES,
  type DebtFormValues,
} from "@/lib/validations/debt";
import { DEBT_TYPE_LABELS, type Debt } from "@/lib/debts-meta";
import type { Account } from "@/lib/accounts-meta";
import { centsToDollars } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DebtDialog({
  open,
  onOpenChange,
  mode,
  accounts,
  debt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  accounts: Account[];
  debt?: Debt;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<DebtFormValues>({
    resolver: zodResolver(debtFormSchema),
    defaultValues: {
      name: debt?.name ?? "",
      type: debt?.type ?? "credit_card",
      balance:
        debt && !debt.linked_account_id
          ? String(centsToDollars(debt.principal_cents))
          : "",
      apr: debt?.apr != null ? String(debt.apr) : "",
      minimum_payment:
        debt?.minimum_payment_cents != null
          ? String(centsToDollars(debt.minimum_payment_cents))
          : "",
      due_day: debt?.due_day != null ? String(debt.due_day) : "",
      linked_account_id: debt?.linked_account_id ?? DEBT_MANUAL,
    },
  });

  const linkedValue = useWatch({
    control: form.control,
    name: "linked_account_id",
  });
  const isManual = (linkedValue ?? DEBT_MANUAL) === DEBT_MANUAL;

  function onSubmit(values: DebtFormValues) {
    const fd = new FormData();
    fd.set("name", values.name);
    fd.set("type", values.type);
    fd.set("linked_account_id", values.linked_account_id ?? DEBT_MANUAL);
    if (isManual && values.balance) fd.set("balance", values.balance);
    if (values.apr) fd.set("apr", values.apr);
    if (values.minimum_payment) fd.set("minimum_payment", values.minimum_payment);
    if (values.due_day) fd.set("due_day", values.due_day);
    if (mode === "edit" && debt) fd.set("id", debt.id);

    startTransition(async () => {
      const result =
        mode === "create" ? await createDebt({}, fd) : await updateDebt({}, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(mode === "create" ? "Debt added" : "Debt updated");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add debt" : "Edit debt"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Visa, Car loan…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DEBT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {DEBT_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="linked_account_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Balance source</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={DEBT_MANUAL}>
                        Manual balance
                      </SelectItem>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          Linked · {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {isManual
                      ? "You enter and maintain the balance."
                      : "Balance follows the linked account."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isManual ? (
              <FormField
                control={form.control}
                name="balance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Balance owed</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        className="tabular-figures"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="apr"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>APR %</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        placeholder="18.99"
                        className="tabular-figures"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="minimum_payment"
                render={({ field }) => (
                  <FormItem className="col-span-1">
                    <FormLabel>Min. pay</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        className="tabular-figures"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="due_day"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due day</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="1–31" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending
                  ? "Saving…"
                  : mode === "create"
                    ? "Add debt"
                    : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
