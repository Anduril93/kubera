/** A reviewed-then-confirmed receipt draft. Never auto-written — the user
 * confirms in the transaction dialog before anything is created. */
export interface ReceiptDraft {
  merchant: string | null;
  /** yyyy-mm-dd */
  date: string | null;
  amountCents: number | null;
  /** Matched to one of the household's visible categories, or null. */
  categoryId: string | null;
  currency: string;
}

export type ScanErrorKind =
  | "rate_limit"
  | "unavailable"
  | "unreadable"
  | "malformed";

export interface ScanReceiptResult {
  draft?: ReceiptDraft;
  error?: string;
  errorKind?: ScanErrorKind;
}
