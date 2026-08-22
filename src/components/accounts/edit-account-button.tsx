"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import type { Account } from "@/lib/accounts-meta";
import { Button } from "@/components/ui/button";
import { AccountDialog } from "@/components/accounts/account-dialog";

export function EditAccountButton({
  account,
  defaultCurrency,
}: {
  account: Account;
  defaultCurrency?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil />
        Edit
      </Button>
      <AccountDialog
        open={open}
        onOpenChange={setOpen}
        mode="edit"
        account={account}
        defaultCurrency={defaultCurrency}
      />
    </>
  );
}
