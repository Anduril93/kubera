"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  createRecurringRule,
  updateRecurringRule,
} from "@/lib/recurring-actions";
import {
  recurringFormSchema,
  type RecurringFormValues,
  RECURRING_TYPES,
  RECURRING_FREQUENCIES,
} from "@/lib/validations/recurring";
import {
  FREQUENCY_LABELS,
  type RecurringRule,
} from "@/lib/recurring-meta";
import type { Account } from "@/lib/accounts-meta";
import type { CategoryOption } from "@/lib/transactions-meta";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TYPE_LABELS: Record<(typeof RECURRING_TYPES)[number], string> = {
  income: "Income",
  expense: "Expense",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function RecurringDialog({
  open,
  onOpenChange,
  mode,
  accounts,
  categories,
  rule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  accounts: Account[];
  categories: CategoryOption[];
  rule?: RecurringRule;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<RecurringFormValues>({
    resolver: zodResolver(recurringFormSchema),
    defaultValues: {
      name: rule?.name ?? "",
      type: rule?.type ?? "expense",
      amount: rule != null ? String(centsToDollars(rule.amount_cents)) : "",
      account_id: rule?.account_id ?? accounts[0]?.id ?? "",
      category_id: rule?.category_id ?? CATEGORY_NONE,
      frequency: rule?.frequency ?? "monthly",
      next_due_date: rule?.next_due_date ?? today(),
      end_date: rule?.end_date ?? "",
      auto_post: rule?.auto_post ?? false,
    },
  });

  function onSubmit(values: RecurringFormValues) {
    const fd = new FormData();
    fd.set("name", values.name);
    fd.set("type", values.type);
    fd.set("amount", values.amount);
    fd.set("account_id", values.account_id);
    fd.set("frequency", values.frequency);
    fd.set("next_due_date", values.next_due_date);
    if (values.category_id && values.category_id !== CATEGORY_NONE) {
      fd.set("category_id", values.category_id);
    }
    if (values.end_date) fd.set("end_date", values.end_date);
    if (values.auto_post) fd.set("auto_post", "true");
    if (mode === "edit" && rule) fd.set("id", rule.id);

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createRecurringRule({}, fd)
          : await updateRecurringRule({}, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(mode === "create" ? "Recurring rule created" : "Rule updated");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New recurring rule" : "Edit recurring rule"}
          </DialogTitle>
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
                    <Input placeholder="Rent, Salary, Netflix…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                        {RECURRING_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {TYPE_LABELS[t]}
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
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequency</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {RECURRING_FREQUENCIES.map((f) => (
                          <SelectItem key={f} value={f}>
                            {FREQUENCY_LABELS[f]}
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
                name="next_due_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Next due</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="end_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>End date (optional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="auto_post"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <FormLabel>Auto-post</FormLabel>
                    <FormDescription>
                      Not automatic yet — for now you post each due instance
                      manually.
                    </FormDescription>
                  </div>
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
                    ? "Create rule"
                    : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
