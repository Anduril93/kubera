import type { Metadata } from "next";
import { Target } from "lucide-react";

import { getGoals } from "@/lib/goals";
import { getAccounts } from "@/lib/accounts";
import { Card, CardContent } from "@/components/ui/card";
import { AddGoalButton } from "@/components/goals/add-goal-button";
import { GoalCard } from "@/components/goals/goal-card";

export const metadata: Metadata = {
  title: "Savings goals · Roundtable Finance",
};

export default async function GoalsPage() {
  const accounts = await getAccounts();
  const currency = accounts[0]?.currency ?? "USD";
  const goals = await getGoals(currency);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Savings goals</h1>
        {goals.length > 0 ? <AddGoalButton accounts={accounts} /> : null}
      </header>

      {goals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="bg-muted rounded-full p-3">
              <Target className="text-muted-foreground size-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-medium">No savings goals yet</h2>
              <p className="text-muted-foreground mx-auto max-w-sm text-sm">
                Set a target to save toward — track it manually, or link an
                account so progress follows its balance.
              </p>
            </div>
            <AddGoalButton accounts={accounts} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {goals.map((item) => (
            <GoalCard key={item.goal.id} item={item} accounts={accounts} />
          ))}
        </div>
      )}
    </div>
  );
}
