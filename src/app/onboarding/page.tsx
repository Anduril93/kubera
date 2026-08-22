import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentHousehold } from "@/lib/household";
import { Onboarding } from "@/components/household/onboarding";

export const metadata: Metadata = {
  title: "Welcome · Roundtable Finance",
};

// Auth-protected by the proxy, but intentionally OUTSIDE the (app) layout's
// household guard — otherwise a user with no household would redirect-loop.
export default async function OnboardingPage() {
  const household = await getCurrentHousehold();
  if (household) redirect("/dashboard");

  return (
    <main className="flex min-h-svh flex-1 items-center justify-center p-6">
      <Onboarding />
    </main>
  );
}
