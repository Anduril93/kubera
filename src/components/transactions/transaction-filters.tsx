"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { TRANSACTION_TYPES } from "@/lib/validations/transaction";
import {
  TRANSACTION_TYPE_LABELS,
  type CategoryOption,
} from "@/lib/transactions-meta";
import type { Account } from "@/lib/accounts-meta";
import {
  CategorySelect,
  CATEGORY_ALL,
} from "@/components/transactions/category-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "all";

export function TransactionFilters({
  accounts,
  categories,
}: {
  accounts: Account[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [search, setSearch] = useState(params.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page"); // any filter change returns to page 1
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router]
  );

  // Debounce the text search.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if ((params.get("q") ?? "") !== search) setParam("q", search || null);
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const hasFilters =
    params.get("q") ||
    params.get("account") ||
    params.get("category") ||
    params.get("type") ||
    params.get("from") ||
    params.get("to");

  function clearAll() {
    setSearch("");
    router.push(pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[12rem] flex-1">
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description or merchant"
          className="pl-8"
        />
      </div>

      <Select
        value={params.get("account") ?? ALL}
        onValueChange={(v) => setParam("account", v === ALL ? null : v)}
      >
        <SelectTrigger className="w-[9rem]">
          <SelectValue placeholder="Account" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All accounts</SelectItem>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="w-[10rem]">
        <CategorySelect
          categories={categories}
          value={params.get("category") ?? CATEGORY_ALL}
          onValueChange={(v) => setParam("category", v === CATEGORY_ALL ? null : v)}
          includeAll
          placeholder="Category"
        />
      </div>

      <Select
        value={params.get("type") ?? ALL}
        onValueChange={(v) => setParam("type", v === ALL ? null : v)}
      >
        <SelectTrigger className="w-[8rem]">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All types</SelectItem>
          {TRANSACTION_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {TRANSACTION_TYPE_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="date"
        aria-label="From date"
        value={params.get("from") ?? ""}
        onChange={(e) => setParam("from", e.target.value || null)}
        className="w-[9.5rem]"
      />
      <Input
        type="date"
        aria-label="To date"
        value={params.get("to") ?? ""}
        onChange={(e) => setParam("to", e.target.value || null)}
        className="w-[9.5rem]"
      />

      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
