"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { deleteBudget } from "@/lib/budget-actions";
import {
  budgetStatus,
  BUDGET_STATUS_META,
  PERIOD_LABELS,
  type BudgetWithSpend,
} from "@/lib/budgets-meta";
import type { CategoryOption } from "@/lib/transactions-meta";
import { formatCurrency } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BudgetProgress } from "@/components/budgets/budget-progress";
import { BudgetStatusBadge } from "@/components/budgets/budget-status-badge";
import { BudgetDialog } from "@/components/budgets/budget-dialog";

export function BudgetItem({
  budget,
  categories,
  currency,
}: {
  budget: BudgetWithSpend;
  categories: CategoryOption[];
  currency: string;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const status = budgetStatus(budget.spentCents, budget.amountCents);
  const over = status === "over";

  function confirmDelete() {
    const fd = new FormData();
    fd.set("id", budget.id);
    startTransition(async () => {
      const result = await deleteBudget({}, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Budget deleted");
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  budget.category?.color ?? "var(--muted-foreground)",
              }}
            />
            <span className="truncate font-medium">
              {budget.category?.name ?? "Category"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <BudgetStatusBadge status={status} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Budget actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <p className="text-muted-foreground text-sm">
          {PERIOD_LABELS[budget.period]} · {budget.periodLabel}
        </p>

        <BudgetProgress
          percent={budget.percentUsed}
          fillClass={BUDGET_STATUS_META[status].fillClass}
        />

        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            <span className="text-foreground tabular-figures font-medium">
              {formatCurrency(budget.spentCents, currency)}
            </span>{" "}
            of{" "}
            <span className="tabular-figures">
              {formatCurrency(budget.amountCents, currency)}
            </span>{" "}
            · {budget.percentUsed}%
          </span>
          {over ? (
            <span className="tabular-figures font-medium text-red-600 dark:text-red-500">
              {formatCurrency(-budget.remainingCents, currency)} over
            </span>
          ) : (
            <span className="text-muted-foreground tabular-figures">
              {formatCurrency(budget.remainingCents, currency)} left
            </span>
          )}
        </div>
      </CardContent>

      <BudgetDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        categories={categories}
        budget={budget}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this budget?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the {budget.category?.name ?? "category"} budget. Your
              transactions aren&rsquo;t affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={pending}
            >
              {pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
