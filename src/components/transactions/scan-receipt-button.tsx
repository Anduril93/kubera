"use client";

import { useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { toast } from "sonner";

import { scanReceipt } from "@/lib/ai/receipt-scan";
import type { ReceiptDraft } from "@/lib/types/ai";
import type { Account } from "@/lib/accounts-meta";
import type { CategoryOption } from "@/lib/transactions-meta";
import { Button } from "@/components/ui/button";
import { TransactionDialog } from "@/components/transactions/transaction-dialog";

export function ScanReceiptButton({
  accounts,
  categories,
}: {
  accounts: Account[];
  categories: CategoryOption[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<ReceiptDraft | undefined>(undefined);
  const [receiptKey, setReceiptKey] = useState<string | undefined>(undefined);
  const [scanId, setScanId] = useState(0);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("file", f));
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as {
        keys?: string[];
        error?: string;
      };
      if (!res.ok || !body.keys || body.keys.length === 0) {
        toast.error(body.error ?? "Upload failed. Enter the transaction manually.");
        return;
      }

      const keys = body.keys;
      const result = await scanReceipt(keys);

      setReceiptKey(keys[0]);
      setScanId((n) => n + 1); // remount the dialog with fresh defaults
      if (result.error || !result.draft) {
        // Scan failed — keep the uploaded receipt and fall back to manual entry.
        toast.error(result.error ?? "Couldn't read the receipt. Enter it manually.");
        setDraft(undefined);
      } else {
        setDraft(result.draft);
        toast.success("Receipt scanned — review and confirm.");
      }
      setDialogOpen(true);
    } catch (err) {
      console.error("[scan-receipt]", err);
      toast.error("Something went wrong. Enter the transaction manually.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={busy || accounts.length === 0}
      >
        <ScanLine />
        {busy ? "Scanning…" : "Scan receipt"}
      </Button>
      <TransactionDialog
        key={scanId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode="create"
        accounts={accounts}
        categories={categories}
        prefill={draft}
        receiptKey={receiptKey}
      />
    </>
  );
}
