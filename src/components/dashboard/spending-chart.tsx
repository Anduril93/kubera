"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { CategorySpend } from "@/lib/dashboard";
import { formatCurrency } from "@/lib/money";

function SpendTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number }[];
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-2.5 py-1.5 text-sm shadow-md">
      <span className="font-medium">{p.name}</span>
      {": "}
      <span className="tabular-figures">
        {formatCurrency(p.value ?? 0, currency)}
      </span>
    </div>
  );
}

export function SpendingChart({
  data,
  currency,
}: {
  data: CategorySpend[];
  currency: string;
}) {
  const total = data.reduce((s, d) => s + d.valueCents, 0);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="mx-auto size-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="valueCents"
              nameKey="name"
              innerRadius={46}
              outerRadius={68}
              paddingAngle={2}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.categoryId ?? d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<SpendTooltip currency={currency} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex-1 space-y-1.5">
        {data.map((d) => (
          <li
            key={d.categoryId ?? d.name}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: d.color }}
              />
              <span className="truncate">{d.name}</span>
            </span>
            <span className="text-muted-foreground tabular-figures whitespace-nowrap">
              {formatCurrency(d.valueCents, currency)}
              {total > 0 ? ` · ${Math.round((d.valueCents / total) * 100)}%` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
