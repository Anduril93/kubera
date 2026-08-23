"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";

import { getReceiptUrl } from "@/lib/receipt-actions";
import { Button } from "@/components/ui/button";

/** Opens a transaction's receipt via a short-lived signed URL (never a public URL). */
export function ReceiptLink({ transactionId }: { transactionId: string }) {
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    const res = await getReceiptUrl(transactionId);
    setLoading(false);
    if (res.error || !res.url) {
      toast.error(res.error ?? "Couldn't open the receipt.");
      return;
    }
    window.open(res.url, "_blank", "noopener,noreferrer");
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={open}
      disabled={loading}
      aria-label="View receipt"
      title="View receipt"
    >
      <Paperclip className="size-3.5" />
    </Button>
  );
}
