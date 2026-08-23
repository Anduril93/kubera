"use client";

import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createGoal, updateGoal } from "@/lib/goal-actions";
import {
  goalFormSchema,
  GOAL_MANUAL,
  type GoalFormValues,
} from "@/lib/validations/goal";
import type { SavingsGoal } from "@/lib/goals-meta";
import type { Account } from "@/lib/accounts-meta";
import { centsToDollars } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function GoalDialog({
  open,
  onOpenChange,
  mode,
  accounts,
  goal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  accounts: Account[];
  goal?: SavingsGoal;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: {
      name: goal?.name ?? "",
      target_amount:
        goal != null ? String(centsToDollars(goal.target_amount_cents)) : "",
      target_date: goal?.target_date ?? "",
      linked_account_id: goal?.linked_account_id ?? GOAL_MANUAL,
      current_amount: "",
    },
  });

  const linkedValue = useWatch({
    control: form.control,
    name: "linked_account_id",
  });
  const isManual = (linkedValue ?? GOAL_MANUAL) === GOAL_MANUAL;

  function onSubmit(values: GoalFormValues) {
    const fd = new FormData();
    fd.set("name", values.name);
    fd.set("target_amount", values.target_amount);
    fd.set("target_date", values.target_date ?? "");
    fd.set("linked_account_id", values.linked_account_id ?? GOAL_MANUAL);
    if (mode === "create" && isManual && values.current_amount) {
      fd.set("current_amount", values.current_amount);
    }
    if (mode === "edit" && goal) fd.set("id", goal.id);

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createGoal({}, fd)
          : await updateGoal({}, fd);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(mode === "create" ? "Goal created" : "Goal updated");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New savings goal" : "Edit goal"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Emergency fund, Vacation…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="target_amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        className="tabular-figures"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="target_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target date (optional)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="linked_account_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Track progress by</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={GOAL_MANUAL}>
                        Manual — I&rsquo;ll update it
                      </SelectItem>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          Linked · {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {isManual
                      ? "You record contributions yourself."
                      : "Progress follows the linked account's balance."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {mode === "create" && isManual ? (
              <FormField
                control={form.control}
                name="current_amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Starting amount (optional)</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        className="tabular-figures"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending
                  ? "Saving…"
                  : mode === "create"
                    ? "Create goal"
                    : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
