import Link from "next/link";
import { Coins } from "lucide-react";

import { logout } from "@/lib/auth-actions";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/shared/mode-toggle";

export function AppShell({
  householdName,
  children,
}: {
  householdName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-semibold"
          >
            <Coins className="size-5 text-primary shrink-0" />
            <span className="hidden sm:inline">Roundtable</span>
          </Link>
          <nav className="flex gap-1 overflow-x-auto">
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/accounts">Accounts</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/transactions">Transactions</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/budgets">Budgets</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/bills">Bills</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/goals">Goals</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/household">Household</Link>
            </Button>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground hidden text-sm md:inline">
            {householdName}
          </span>
          <ModeToggle />
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
