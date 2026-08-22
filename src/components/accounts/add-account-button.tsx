"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AccountDialog } from "@/components/accounts/account-dialog";

export function AddAccountButton({
  defaultCurrency,
  variant = "default",
  size = "default",
  label = "Add account",
}: {
  defaultCurrency?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Plus />
        {label}
      </Button>
      <AccountDialog
        open={open}
        onOpenChange={setOpen}
        mode="create"
        defaultCurrency={defaultCurrency}
      />
    </>
  );
}
