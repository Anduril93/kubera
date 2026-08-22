import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAuthUser } from "@/lib/auth-helper";
import { getCurrentHousehold, getHouseholdMembers } from "@/lib/household";
import { HouseholdNameCard } from "@/components/household/household-name-card";
import { InviteCodeCard } from "@/components/household/invite-code-card";
import { MembersCard } from "@/components/household/members-card";

export const metadata: Metadata = {
  title: "Household · Roundtable Finance",
};

export default async function HouseholdPage() {
  const household = await getCurrentHousehold();
  if (!household) redirect("/onboarding");

  const user = await getAuthUser();
  const isOwner = household.owner_id === user?.id;
  const members = await getHouseholdMembers(household.id);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Household</h1>
      <HouseholdNameCard name={household.name} isOwner={isOwner} />
      <InviteCodeCard code={household.invite_code} isOwner={isOwner} />
      <MembersCard members={members} currentUserId={user?.id ?? ""} />
    </div>
  );
}
