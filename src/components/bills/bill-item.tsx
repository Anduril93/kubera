"use client";

import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { MoreHorizontal, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  deleteRecurringRule,
  postRecurringRule,
} from "@/lib/recurring-actions";
import {
  FREQUENCY_LABELS,
  advanceRecurringDate,
  isOverdue,
  recurringSignedCents,
  type RecurringRule,
} from "@/lib/recurring-meta";
import type { Account } from "@/lib/accounts-meta";
import type { CategoryOption } from "@/lib/transactions-meta";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";
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
import { RecurringDialog } from "@/components/bills/recurring-dialog";

const fmtDate = (d: string) => format(parseISO(d), "MMM d, yyyy");

export function BillItem({
  rule,
  accounts,
  categories,
  currency,
  todayYmd,
}: {
  rule: RecurringRule;
  accounts: Account[];
  categories: CategoryOption[];
  currency: string;
  todayYmd: string;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const overdue = isOverdue(rule, todayYmd);
  const nextDate = advanceRecurringDate(rule.next_due_date, rule.frequency);

  function confirmPost() {
    startTransition(async () => {
      const result = await postRecurringRule(rule.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.notDue) {
        toast.info("This rule isn't due yet — nothing was posted.");
        setPostOpen(false);
        return;
      }
      toast.success("Posted");
      setPostOpen(false);
      router.refresh();
    });
  }

  function confirmDelete() {
    const fd = new FormData();
    fd.set("id", rule.id);
    startTransition(async () => {
      const result = await deleteRecurringRule({}, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Recurring rule deleted");
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <Card className={cn(overdue && "border-red-500/50")}>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{rule.name}</span>
              <Badge variant="secondary" className="capitalize">
                {rule.type}
              </Badge>
              {overdue ? (
                <Badge
                  variant="outline"
                  className="border-transparent bg-red-500/15 text-red-700 dark:text-red-400"
                >
                  Overdue
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground truncate text-sm">
              {rule.account?.name ?? "—"}
              {rule.category?.name ? ` · ${rule.category.name}` : ""} ·{" "}
              {FREQUENCY_LABELS[rule.frequency]}
            </p>
            <p
              className={cn(
                "text-sm",
                overdue
                  ? "font-medium text-red-600 dark:text-red-500"
                  : "text-muted-foreground"
              )}
            >
              {overdue ? "Was due" : "Next due"} {fmtDate(rule.next_due_date)}
            </p>
          </div>
          <MoneyAmount
            cents={recurringSignedCents(rule)}
            currency={currency}
            tone="signed"
            className="shrink-0 font-medium"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setPostOpen(true)}>
            <Send />
            Post now
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Rule actions">
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
      </CardContent>

      {/* Post-now confirm: shows exactly what will be created */}
      <AlertDialog open={postOpen} onOpenChange={setPostOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post {rule.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>This creates a transaction:</p>
                <ul className="bg-muted/50 space-y-1 rounded-md p-3">
                  <li>
                    <span className="text-muted-foreground">Type:</span>{" "}
                    <span className="capitalize">{rule.type}</span>
                  </li>
                  <li>
                    <span className="text-muted-foreground">Amount:</span>{" "}
                    <span className="tabular-figures">
                      {formatCurrency(rule.amount_cents, currency)}
                    </span>
                  </li>
                  <li>
                    <span className="text-muted-foreground">Account:</span>{" "}
                    {rule.account?.name ?? "—"}
                  </li>
                  {rule.category?.name ? (
                    <li>
                      <span className="text-muted-foreground">Category:</span>{" "}
                      {rule.category.name}
                    </li>
                  ) : null}
                  <li>
                    <span className="text-muted-foreground">Date:</span>{" "}
                    {fmtDate(rule.next_due_date)}
                  </li>
                </ul>
                <p className="text-muted-foreground">
                  The next due date then advances to {fmtDate(nextDate)}.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmPost();
              }}
              disabled={pending}
            >
              {pending ? "Posting…" : "Post transaction"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RecurringDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        accounts={accounts}
        categories={categories}
        rule={rule}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {rule.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the recurring rule. Transactions you&rsquo;ve already
              posted from it are not affected.
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
