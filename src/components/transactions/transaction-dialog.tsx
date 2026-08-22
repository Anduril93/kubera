"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createTransaction, updateTransaction } from "@/lib/transaction-actions";
import {
  transactionFormSchema,
  type TransactionFormValues,
  TRANSACTION_TYPES,
} from "@/lib/validations/transaction";
import {
  TRANSACTION_TYPE_LABELS,
  type CategoryOption,
  type LedgerTransaction,
} from "@/lib/transactions-meta";
import type { Account } from "@/lib/accounts-meta";
import { centsToDollars } from "@/lib/money";
import {
  CategorySelect,
  CATEGORY_NONE,
} from "@/components/transactions/category-select";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function TransactionDialog({
  open,
  onOpenChange,
  mode,
  accounts,
  categories,
  transaction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  accounts: Account[];
  categories: CategoryOption[];
  transaction?: LedgerTransaction;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: {
      account_id: transaction?.account_id ?? accounts[0]?.id ?? "",
      category_id: transaction?.category_id ?? CATEGORY_NONE,
      type: transaction?.type ?? "expense",
      amount:
        transaction != null
          ? String(centsToDollars(transaction.amount_cents))
          : "",
      date: transaction?.date ?? today(),
      merchant: transaction?.merchant ?? "",
      notes: transaction?.notes ?? "",
      pending: transaction?.pending ?? false,
    },
  });

  function onSubmit(values: TransactionFormValues) {
    const fd = new FormData();
    fd.set("account_id", values.account_id);
    fd.set("type", values.type);
    fd.set("amount", values.amount);
    fd.set("date", values.date);
    if (values.category_id && values.category_id !== CATEGORY_NONE) {
      fd.set("category_id", values.category_id);
    }
    fd.set("merchant", values.merchant ?? "");
    fd.set("notes", values.notes ?? "");
    if (values.pending) fd.set("pending", "true");
    if (mode === "edit" && transaction) fd.set("id", transaction.id);

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createTransaction({}, fd)
          : await updateTransaction({}, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(mode === "create" ? "Transaction added" : "Transaction updated");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add transaction" : "Edit transaction"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
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
                        {TRANSACTION_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {TRANSACTION_TYPE_LABELS[t]}
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
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
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
            </div>

            <FormField
              control={form.control}
              name="account_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select an account" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
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
              name="category_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <FormControl>
                    <CategorySelect
                      categories={categories}
                      value={field.value || CATEGORY_NONE}
                      onValueChange={field.onChange}
                      includeNone
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="merchant"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Merchant</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="pending"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between">
                  <FormLabel>Pending</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending
                  ? "Saving…"
                  : mode === "create"
                    ? "Add transaction"
                    : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
