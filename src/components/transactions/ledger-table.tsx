import type { LedgerItem, CategoryOption } from "@/lib/transactions-meta";
import type { Account } from "@/lib/accounts-meta";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LedgerRow } from "@/components/transactions/ledger-row";

export function LedgerTable({
  items,
  accounts,
  categories,
}: {
  items: LedgerItem[];
  accounts: Account[];
  categories: CategoryOption[];
}) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 pr-0" />
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="hidden sm:table-cell">Category</TableHead>
            <TableHead className="hidden md:table-cell">Account</TableHead>
            <TableHead className="hidden lg:table-cell">Entered by</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="w-8 pl-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <LedgerRow
              key={item.transaction.id}
              item={item}
              accounts={accounts}
              categories={categories}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
