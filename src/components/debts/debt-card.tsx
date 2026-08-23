"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { deleteDebt } from "@/lib/debt-actions";
import {
  DEBT_TYPE_LABELS,
  formatPayoffDuration,
  type DebtWithBalance,
} from "@/lib/debts-meta";
import type { Account } from "@/lib/accounts-meta";
import { formatCurrency } from "@/lib/money";
import { MoneyAmount } from "@/components/shared/money-amount";
import { Badge } from "@/components/ui/badge";
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
import { DebtDialog } from "@/components/debts/debt-dialog";

function payoffText(item: DebtWithBalance): string {
  const { payoff } = item;
  switch (payoff.status) {
    case "paid_off":
      return "Paid off.";
    case "no_payment":
      return "Add a minimum payment to estimate payoff.";
    case "min_below_interest":
      return "The minimum payment doesn't cover the monthly interest — the balance won't go down at this rate.";
    case "ok":
      return `About ${formatPayoffDuration(payoff.months ?? 0)} to pay off at the minimum — an estimate assuming no new charges.`;
  }
}

export function DebtCard({
  item,
  accounts,
}: {
  item: DebtWithBalance;
  accounts: Account[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const { debt, mode, currency } = item;

  const details: string[] = [];
  if (item.apr != null) details.push(`${item.apr}% APR`);
  if (item.minimumPaymentCents != null)
    details.push(`${formatCurrency(item.minimumPaymentCents, currency)}/mo min`);
  if (item.dueDay != null) details.push(`due day ${item.dueDay}`);

  function confirmDelete() {
    const fd = new FormData();
    fd.set("id", debt.id);
    startTransition(async () => {
      const result = await deleteDebt({}, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Debt deleted");
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{debt.name}</span>
              <Badge variant="secondary">{DEBT_TYPE_LABELS[debt.type]}</Badge>
            </div>
            <Badge variant="outline" className="text-muted-foreground">
              {mode === "linked"
                ? `Linked · ${item.linkedAccountName ?? "account"}`
                : "Manual"}
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <MoneyAmount
              cents={item.balanceCents}
              currency={currency}
              tone="liability"
              className="text-lg font-semibold"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Debt actions">
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

        {details.length > 0 ? (
          <p className="text-muted-foreground text-sm">{details.join(" · ")}</p>
        ) : null}

        <p className="text-muted-foreground text-sm">{payoffText(item)}</p>
      </CardContent>

      <DebtDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        accounts={accounts}
        debt={debt}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {debt.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the debt record. Your accounts and transactions are
              not affected.
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
