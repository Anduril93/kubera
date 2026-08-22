/**
 * Default category seed + Category type. Shared by client and server (no
 * server-only imports). Icon names are lucide-react icon identifiers; colors
 * are hex strings used for chart/legend swatches. Reserve red/green for
 * money semantics — these category colors stay in other hues.
 */

export type CategoryKind = "income" | "expense" | "transfer";

export interface Category {
  /** Stable slug used to seed/lookup the system default; not the DB uuid. */
  slug: string;
  name: string;
  kind: CategoryKind;
  /** lucide-react icon name. */
  icon: string;
  /** Hex color for swatches/charts. */
  color: string;
}

export const DEFAULT_CATEGORIES: Category[] = [
  // ── Income ────────────────────────────────────────────────────────────────
  { slug: "salary", name: "Salary", kind: "income", icon: "Wallet", color: "#0ea5e9" },
  { slug: "freelance", name: "Freelance", kind: "income", icon: "Laptop", color: "#6366f1" },
  { slug: "interest", name: "Interest & Dividends", kind: "income", icon: "PiggyBank", color: "#14b8a6" },
  { slug: "gifts-income", name: "Gifts", kind: "income", icon: "Gift", color: "#a855f7" },
  { slug: "refunds", name: "Refunds", kind: "income", icon: "RotateCcw", color: "#8b5cf6" },
  { slug: "other-income", name: "Other Income", kind: "income", icon: "Plus", color: "#64748b" },

  // ── Expenses ────────────────────────────────────────────────────────────────
  { slug: "groceries", name: "Groceries", kind: "expense", icon: "ShoppingCart", color: "#f59e0b" },
  { slug: "dining", name: "Dining & Takeout", kind: "expense", icon: "Utensils", color: "#fb923c" },
  { slug: "housing", name: "Housing & Rent", kind: "expense", icon: "Home", color: "#0284c7" },
  { slug: "utilities", name: "Utilities", kind: "expense", icon: "Zap", color: "#eab308" },
  { slug: "transportation", name: "Transportation", kind: "expense", icon: "Car", color: "#3b82f6" },
  { slug: "fuel", name: "Fuel", kind: "expense", icon: "Fuel", color: "#f97316" },
  { slug: "health", name: "Health & Medical", kind: "expense", icon: "HeartPulse", color: "#ec4899" },
  { slug: "insurance", name: "Insurance", kind: "expense", icon: "ShieldCheck", color: "#0891b2" },
  { slug: "entertainment", name: "Entertainment", kind: "expense", icon: "Clapperboard", color: "#d946ef" },
  { slug: "shopping", name: "Shopping", kind: "expense", icon: "ShoppingBag", color: "#f43f5e" },
  { slug: "subscriptions", name: "Subscriptions", kind: "expense", icon: "Repeat", color: "#8b5cf6" },
  { slug: "travel", name: "Travel", kind: "expense", icon: "Plane", color: "#06b6d4" },
  { slug: "education", name: "Education", kind: "expense", icon: "GraduationCap", color: "#6366f1" },
  { slug: "personal-care", name: "Personal Care", kind: "expense", icon: "Sparkles", color: "#e879f9" },
  { slug: "gifts-expense", name: "Gifts & Donations", kind: "expense", icon: "HandHeart", color: "#a855f7" },
  { slug: "kids", name: "Kids & Family", kind: "expense", icon: "Baby", color: "#fb7185" },
  { slug: "pets", name: "Pets", kind: "expense", icon: "PawPrint", color: "#fbbf24" },
  { slug: "fees", name: "Fees & Charges", kind: "expense", icon: "Receipt", color: "#94a3b8" },
  { slug: "taxes", name: "Taxes", kind: "expense", icon: "Landmark", color: "#475569" },
  { slug: "debt-payment", name: "Debt Payment", kind: "expense", icon: "CreditCard", color: "#7c3aed" },
  { slug: "other-expense", name: "Other Expense", kind: "expense", icon: "MoreHorizontal", color: "#64748b" },

  // ── Transfer ────────────────────────────────────────────────────────────────
  { slug: "transfer", name: "Transfer", kind: "transfer", icon: "ArrowLeftRight", color: "#64748b" },
  { slug: "savings", name: "Savings", kind: "transfer", icon: "PiggyBank", color: "#10b981" },
];

/** Convenience lookups. */
export const DEFAULT_INCOME_CATEGORIES = DEFAULT_CATEGORIES.filter(
  (c) => c.kind === "income"
);
export const DEFAULT_EXPENSE_CATEGORIES = DEFAULT_CATEGORIES.filter(
  (c) => c.kind === "expense"
);

export function getDefaultCategory(slug: string): Category | undefined {
  return DEFAULT_CATEGORIES.find((c) => c.slug === slug);
}
