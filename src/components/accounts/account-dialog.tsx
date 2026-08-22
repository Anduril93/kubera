"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createAccount, updateAccount } from "@/lib/account-actions";
import {
  accountFormSchema,
  type AccountFormValues,
  ACCOUNT_TYPES,
} from "@/lib/validations/account";
import { ACCOUNT_TYPE_LABELS, type Account } from "@/lib/accounts-meta";
import { centsToDollars } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

export function AccountDialog({
  open,
  onOpenChange,
  mode,
  account,
  defaultCurrency = "USD",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  account?: Account;
  defaultCurrency?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: account?.name ?? "",
      type: account?.type ?? "checking",
      institution: account?.institution ?? "",
      balance:
        account != null ? String(centsToDollars(account.current_balance_cents)) : "",
      currency: account?.currency ?? defaultCurrency,
    },
  });

  function onSubmit(values: AccountFormValues) {
    const fd = new FormData();
    fd.set("name", values.name);
    fd.set("type", values.type);
    fd.set("institution", values.institution ?? "");
    fd.set("currency", values.currency);
    if (mode === "create") {
      fd.set("starting_balance", values.balance ?? "");
    } else if (account) {
      fd.set("id", account.id);
      fd.set("balance", values.balance ?? "");
    }

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createAccount({}, fd)
          : await updateAccount({}, fd);

      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(mode === "create" ? "Account created" : "Account updated");
      onOpenChange(false);
      form.reset(values);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add account" : "Edit account"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Add a manual account to track its balance."
              : "Update this account's details."}
          </DialogDescription>
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
                    <Input placeholder="Everyday Checking" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {ACCOUNT_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="institution"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Institution (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Bank name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="balance"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>
                      {mode === "create" ? "Starting balance" : "Balance"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        className="tabular-figures"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>In dollars.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <FormControl>
                      <Input maxLength={3} className="uppercase" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending
                  ? "Saving…"
                  : mode === "create"
                    ? "Add account"
                    : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
