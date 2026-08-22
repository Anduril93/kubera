"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import type { CategoryOption } from "@/lib/transactions-meta";
import { Button } from "@/components/ui/button";
import { BudgetDialog } from "@/components/budgets/budget-dialog";

export function AddBudgetButton({
  categories,
  label = "Create budget",
}: {
  categories: CategoryOption[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        {label}
      </Button>
      <BudgetDialog
        open={open}
        onOpenChange={setOpen}
        mode="create"
        categories={categories}
      />
    </>
  );
}
