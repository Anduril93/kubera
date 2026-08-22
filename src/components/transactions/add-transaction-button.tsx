"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import type { Account } from "@/lib/accounts-meta";
import type { CategoryOption } from "@/lib/transactions-meta";
import { Button } from "@/components/ui/button";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";

export function AddTransactionButton({
  accounts,
  categories,
  label = "Add transaction",
}: {
  accounts: Account[];
  categories: CategoryOption[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const disabled = accounts.length === 0;

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled}>
        <Plus />
        {label}
      </Button>
      {disabled ? null : (
        <TransactionDialog
          open={open}
          onOpenChange={setOpen}
          mode="create"
          accounts={accounts}
          categories={categories}
        />
      )}
    </>
  );
}
