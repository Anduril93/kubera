"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { splitTransaction } from "@/lib/transaction-actions";
import {
  type CategoryOption,
  type LedgerTransaction,
} from "@/lib/transactions-meta";
import { centsToDollars, formatCurrency } from "@/lib/money";
import {
  CategorySelect,
  CATEGORY_NONE,
} from "@/components/transactions/category-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface ChildRow {
  category_id: string;
  amount: string;
}

function dollarsToCentsLoose(amount: string): number {
  const n = Number(amount.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function SplitDialog({
  open,
  onOpenChange,
  transaction,
  existingChildren,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: LedgerTransaction;
  existingChildren: LedgerTransaction[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [rows, setRows] = useState<ChildRow[]>(() =>
    existingChildren.length >= 2
      ? existingChildren.map((c) => ({
          category_id: c.category_id ?? CATEGORY_NONE,
          amount: String(centsToDollars(c.amount_cents)),
        }))
      : [
          { category_id: CATEGORY_NONE, amount: "" },
          { category_id: CATEGORY_NONE, amount: "" },
        ]
  );

  const sumCents = useMemo(
    () => rows.reduce((s, r) => s + dollarsToCentsLoose(r.amount), 0),
    [rows]
  );
  const remaining = transaction.amount_cents - sumCents;
  const balanced = remaining === 0;

  function setRow(i: number, patch: Partial<ChildRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { category_id: CATEGORY_NONE, amount: "" }]);
  }
  function removeRow(i: number) {
    setRows((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  function onSubmit() {
    const fd = new FormData();
    fd.set("transaction_id", transaction.id);
    fd.set(
      "children",
      JSON.stringify(
        rows.map((r) => ({
          category_id: r.category_id === CATEGORY_NONE ? null : r.category_id,
          amount: r.amount,
        }))
      )
    );
    startTransition(async () => {
      const result = await splitTransaction({}, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Transaction split");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Split transaction</DialogTitle>
          <DialogDescription>
            Divide{" "}
            <span className="tabular-figures font-medium">
              {formatCurrency(transaction.amount_cents, transaction.currency)}
            </span>{" "}
            into parts that sum to the total. This doesn&rsquo;t change the
            account balance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <CategorySelect
                  categories={categories}
                  value={row.category_id}
                  onValueChange={(v) => setRow(i, { category_id: v })}
                  includeNone
                />
              </div>
              <Input
                inputMode="decimal"
                placeholder="0.00"
                className="tabular-figures w-28"
                value={row.amount}
                onChange={(e) => setRow(i, { amount: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => removeRow(i)}
                disabled={rows.length <= 2}
                aria-label="Remove part"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus />
            Add part
          </Button>
        </div>

        <div className="flex items-center justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">Remaining to allocate</span>
          <span
            className={`tabular-figures font-medium ${balanced ? "text-emerald-600 dark:text-emerald-500" : "text-red-600 dark:text-red-500"}`}
          >
            {formatCurrency(remaining, transaction.currency)}
          </span>
        </div>

        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending || !balanced}>
            {pending ? "Splitting…" : "Save split"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
