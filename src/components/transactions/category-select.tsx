"use client";

import {
  groupCategoriesByKind,
  type CategoryOption,
} from "@/lib/transactions-meta";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Sentinel values (Radix Select disallows empty string item values). */
export const CATEGORY_NONE = "none";
export const CATEGORY_ALL = "all";

export function CategorySelect({
  categories,
  value,
  onValueChange,
  includeNone = false,
  includeAll = false,
  placeholder = "Category",
  triggerClassName,
}: {
  categories: CategoryOption[];
  value: string;
  onValueChange: (value: string) => void;
  includeNone?: boolean;
  includeAll?: boolean;
  placeholder?: string;
  triggerClassName?: string;
}) {
  const groups = groupCategoriesByKind(categories);

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName ?? "w-full"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {includeAll ? (
          <SelectItem value={CATEGORY_ALL}>All categories</SelectItem>
        ) : null}
        {includeNone ? (
          <SelectItem value={CATEGORY_NONE}>No category</SelectItem>
        ) : null}
        {groups.map((group) => (
          <SelectGroup key={group.kind}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
