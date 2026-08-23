"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { contributeToGoal } from "@/lib/goal-actions";
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
import { Label } from "@/components/ui/label";

export function ContributeDialog({
  open,
  onOpenChange,
  goalId,
  goalName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goalId: string;
  goalName: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await contributeToGoal(goalId, amount);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Contribution recorded");
      setAmount("");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add to {goalName}</DialogTitle>
          <DialogDescription>
            Record money you&rsquo;ve set aside. Use a negative amount to
            withdraw.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="grid gap-3"
        >
          <div className="grid gap-2">
            <Label htmlFor="contribution-amount">Amount</Label>
            <Input
              id="contribution-amount"
              inputMode="decimal"
              placeholder="0.00"
              className="tabular-figures"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || amount.trim() === ""}>
              {pending ? "Saving…" : "Add contribution"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
