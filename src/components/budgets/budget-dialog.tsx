"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createBudget, updateBudget } from "@/lib/budget-actions";
import {
  budgetCreateSchema,
  type BudgetCreateInput,
  BUDGET_PERIODS,
} from "@/lib/validations/budget";
import { PERIOD_LABELS, type BudgetWithSpend } from "@/lib/budgets-meta";
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function BudgetDialog({
  open,
  onOpenChange,
  mode,
  categories,
  budget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** Expense categories only. */
  categories: CategoryOption[];
  budget?: BudgetWithSpend;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<BudgetCreateInput>({
    resolver: zodResolver(budgetCreateSchema),
    defaultValues: {
      category_id: budget?.category?.id ?? "",
      period: budget?.period ?? "monthly",
      amount:
        budget != null ? String(centsToDollars(budget.amountCents)) : "",
      start_date: budget?.startDate ?? today(),
    },
  });

  function onSubmit(values: BudgetCreateInput) {
    const fd = new FormData();
    fd.set("category_id", values.category_id);
    fd.set("period", values.period);
    fd.set("amount", values.amount);
    if (values.start_date) fd.set("start_date", values.start_date);
    if (mode === "edit" && budget) fd.set("id", budget.id);

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createBudget({}, fd)
          : await updateBudget({}, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(mode === "create" ? "Budget created" : "Budget updated");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create budget" : "Edit budget"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
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
                      onValueChange={(v) =>
                        field.onChange(v === CATEGORY_NONE ? "" : v)
                      }
                      placeholder="Pick a category"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="period"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Period</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BUDGET_PERIODS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {PERIOD_LABELS[p]}
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
              name="start_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Start date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending
                  ? "Saving…"
                  : mode === "create"
                    ? "Create budget"
                    : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
