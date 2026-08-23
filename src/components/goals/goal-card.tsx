"use client";

import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { MoreHorizontal, PiggyBank, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { deleteGoal } from "@/lib/goal-actions";
import {
  GOAL_PACE_LABELS,
  type GoalPaceStatus,
  type GoalWithProgress,
} from "@/lib/goals-meta";
import type { Account } from "@/lib/accounts-meta";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";
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
import { ProgressBar } from "@/components/shared/progress-bar";
import { GoalDialog } from "@/components/goals/goal-dialog";
import { ContributeDialog } from "@/components/goals/contribute-dialog";

// Red/green reserved for money sign — pace uses amber for behind/past-due,
// emerald only for a completed (positive) goal, neutral for on-pace.
function paceClass(status: GoalPaceStatus): string {
  switch (status) {
    case "complete":
      return "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "behind":
    case "past_due":
      return "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400";
    default:
      return "";
  }
}

export function GoalCard({
  item,
  accounts,
}: {
  item: GoalWithProgress;
  accounts: Account[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contributeOpen, setContributeOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const { goal, mode, currency } = item;

  function confirmDelete() {
    const fd = new FormData();
    fd.set("id", goal.id);
    startTransition(async () => {
      const result = await deleteGoal({}, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Goal deleted");
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: `${goal.color ?? "#10b981"}22` }}
              >
                <PiggyBank
                  className="size-3.5"
                  style={{ color: goal.color ?? "#10b981" }}
                />
              </span>
              <span className="truncate font-medium">{goal.name}</span>
            </div>
            <Badge variant="secondary">
              {mode === "linked"
                ? `Linked · ${item.linkedAccountName ?? "account"}`
                : "Manual"}
            </Badge>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Goal actions">
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

        <ProgressBar
          percent={item.percentComplete}
          fillClass={item.isComplete ? "bg-emerald-500" : "bg-primary"}
        />

        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            <span className="text-foreground tabular-figures font-medium">
              {formatCurrency(item.currentCents, currency)}
            </span>{" "}
            of{" "}
            <span className="tabular-figures">
              {formatCurrency(item.targetCents, currency)}
            </span>{" "}
            · {item.percentComplete}%
          </span>
          {item.isComplete ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-500">
              Complete
            </span>
          ) : (
            <span className="text-muted-foreground tabular-figures">
              {formatCurrency(item.remainingCents, currency)} to go
            </span>
          )}
        </div>

        {item.pace ? (
          <div className="flex items-center gap-2 text-sm">
            <Badge
              variant="outline"
              className={cn(paceClass(item.pace.status))}
            >
              {GOAL_PACE_LABELS[item.pace.status]}
            </Badge>
            <span className="text-muted-foreground">
              by {format(parseISO(item.pace.targetDate), "MMM d, yyyy")}
            </span>
          </div>
        ) : null}

        {mode === "manual" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setContributeOpen(true)}
          >
            <Plus />
            Add contribution
          </Button>
        ) : null}
      </CardContent>

      <GoalDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        accounts={accounts}
        goal={goal}
      />
      <ContributeDialog
        open={contributeOpen}
        onOpenChange={setContributeOpen}
        goalId={goal.id}
        goalName={goal.name}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {goal.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the goal. Your accounts and transactions are not
              affected.
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
