"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import type { Account } from "@/lib/accounts-meta";
import { Button } from "@/components/ui/button";
import { GoalDialog } from "@/components/goals/goal-dialog";

export function AddGoalButton({
  accounts,
  label = "New goal",
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
      <GoalDialog
        open={open}
        onOpenChange={setOpen}
        mode="create"
        accounts={accounts}
      />
    </>
  );
}
