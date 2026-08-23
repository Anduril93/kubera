"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import type { Account } from "@/lib/accounts-meta";
import { Button } from "@/components/ui/button";
import { DebtDialog } from "@/components/debts/debt-dialog";

export function AddDebtButton({
  accounts,
  label = "Add debt",
}: {
  accounts: Account[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        {label}
      </Button>
      <DebtDialog
        open={open}
        onOpenChange={setOpen}
        mode="create"
        accounts={accounts}
      />
    </>
  );
}
