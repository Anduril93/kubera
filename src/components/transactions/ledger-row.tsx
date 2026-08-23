"use client";

import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  MoreHorizontal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { deleteTransaction } from "@/lib/transaction-actions";
import {
  signedAmountCents,
  creatorLabel,
  type CategoryOption,
  type LedgerItem,
} from "@/lib/transactions-meta";
import type { Account } from "@/lib/accounts-meta";
import { formatCurrency } from "@/lib/money";
import { MoneyAmount } from "@/components/shared/money-amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
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
import { TransactionDialog } from "@/components/transactions/transaction-dialog";
import { SplitDialog } from "@/components/transactions/split-dialog";
import { ReceiptLink } from "@/components/transactions/receipt-link";

function CategoryTag({
  name,
  color,
}: {
  name: string | null;
  color: string | null;
}) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function LedgerRow({
  item,
  accounts,
  categories,
}: {
  item: LedgerItem;
  accounts: Account[];
  categories: CategoryOption[];
}) {
  const { transaction: t, children } = item;
  const hasChildren = children.length > 0;

  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const who = creatorLabel(t.creator);
  const title = t.merchant || t.description || "—";
  const subtitle = t.merchant && t.description ? t.description : null;

  function confirmDelete() {
    const fd = new FormData();
    fd.set("id", t.id);
    startTransition(async () => {
      const result = await deleteTransaction({}, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Transaction deleted");
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <TableRow>
        <TableCell className="w-8 pr-0 align-top">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground mt-0.5"
              aria-label={expanded ? "Collapse split" : "Expand split"}
            >
              {expanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
          ) : null}
        </TableCell>
        <TableCell className="text-muted-foreground whitespace-nowrap align-top text-sm">
          {format(parseISO(t.date), "MMM d")}
        </TableCell>
        <TableCell className="align-top">
          <div className="flex items-center gap-2">
            <span className="font-medium">{title}</span>
            {hasChildren ? (
              <Badge variant="secondary" className="text-xs">
                Split
              </Badge>
            ) : null}
            {t.pending ? (
              <Badge variant="outline" className="text-xs">
                Pending
              </Badge>
            ) : null}
            {t.receipt_url ? <ReceiptLink transactionId={t.id} /> : null}
          </div>
          {subtitle ? (
            <p className="text-muted-foreground truncate text-sm">{subtitle}</p>
          ) : null}
        </TableCell>
        <TableCell className="hidden align-top sm:table-cell">
          <CategoryTag name={t.category?.name ?? null} color={t.category?.color ?? null} />
        </TableCell>
        <TableCell className="text-muted-foreground hidden align-top md:table-cell">
          {t.account?.name ?? "—"}
        </TableCell>
        <TableCell className="text-muted-foreground hidden align-top lg:table-cell">
          {who ?? "—"}
        </TableCell>
        <TableCell className="align-top text-right">
          <MoneyAmount
            cents={signedAmountCents(t.type, t.amount_cents)}
            currency={t.currency}
            tone="signed"
            className="font-medium"
          />
        </TableCell>
        <TableCell className="w-8 pl-0 align-top">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Transaction actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSplitOpen(true)}>
                {hasChildren ? "Edit split" : "Split"}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

      {expanded
        ? children.map((c) => (
            <TableRow key={c.id} className="bg-muted/30">
              <TableCell className="pr-0" />
              <TableCell />
              <TableCell className="text-muted-foreground align-top">
                <span className="inline-flex items-center gap-1.5">
                  <CornerDownRight className="size-3.5" />
                  <CategoryTag
                    name={c.category?.name ?? null}
                    color={c.category?.color ?? null}
                  />
                </span>
                {c.description ? (
                  <p className="text-muted-foreground pl-5 text-sm">
                    {c.description}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden md:table-cell" />
              <TableCell className="hidden lg:table-cell" />
              <TableCell className="text-muted-foreground tabular-figures align-top text-right">
                {formatCurrency(c.amount_cents, c.currency)}
              </TableCell>
              <TableCell className="pl-0" />
            </TableRow>
          ))
        : null}

      <TransactionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        accounts={accounts}
        categories={categories}
        transaction={t}
      />
      <SplitDialog
        open={splitOpen}
        onOpenChange={setSplitOpen}
        transaction={t}
        existingChildren={children}
        categories={categories}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the transaction
              {hasChildren ? " and its split parts" : ""} and updates the account
              balance. This can&rsquo;t be undone.
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
    </>
  );
}
