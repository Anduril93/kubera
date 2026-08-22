import { redirect } from "next/navigation";
import { Coins } from "lucide-react";

import { getAuthUser } from "@/lib/auth-helper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModeToggle } from "@/components/shared/mode-toggle";

export default async function Home() {
  // Authenticated users go straight to their dashboard.
  const user = await getAuthUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2 font-semibold">
          <Coins className="size-5 text-primary" />
          <span>Roundtable Finance</span>
        </div>
        <ModeToggle />
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <Badge variant="secondary">Working title — Phase 1</Badge>
        <div className="space-y-3">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Your household&rsquo;s private finances,
            <br className="hidden sm:block" /> at one table.
          </h1>
          <p className="text-muted-foreground mx-auto max-w-prose text-balance">
            Track income, expenses, budgets, bills, goals, debts, and net worth
            — with AI assistance and bank sync. Everything stays private to your
            household.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button>Get started</Button>
          <Button variant="outline">Sign in</Button>
        </div>
        <p className="text-muted-foreground tabular-figures text-sm">
          Net worth · $0.00
        </p>
      </section>

      <footer className="text-muted-foreground border-t px-6 py-4 text-center text-xs">
        Private · single household · no public surface
      </footer>
    </main>
  );
}
