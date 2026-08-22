import { redirect } from "next/navigation";

import { getCurrentHousehold } from "@/lib/household";
import { AppShell } from "@/components/layout/app-shell";

// Protected app shell. The proxy guarantees an authenticated user here; this
// layer adds the household guard: no household → onboarding.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const household = await getCurrentHousehold();
  if (!household) redirect("/onboarding");

  return <AppShell householdName={household.name}>{children}</AppShell>;
}
