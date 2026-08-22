import { UserRound } from "lucide-react";

import type { HouseholdMemberView } from "@/lib/household";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function MembersCard({
  members,
  currentUserId,
}: {
  members: HouseholdMemberView[];
  currentUserId: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Everyone in the household has full access to all of its finances.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-border divide-y">
          {members.map((m) => {
            const label = m.fullName || m.email || "Household member";
            const isYou = m.userId === currentUserId;
            return (
              <li
                key={m.userId}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex items-center gap-3">
                  <span className="bg-muted flex size-9 items-center justify-center rounded-full">
                    <UserRound className="size-4" />
                  </span>
                  <div className="leading-tight">
                    <p className="font-medium">
                      {label}
                      {isYou ? (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          (you)
                        </span>
                      ) : null}
                    </p>
                    {m.email && m.fullName ? (
                      <p className="text-muted-foreground text-sm">{m.email}</p>
                    ) : null}
                  </div>
                </div>
                <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                  {m.role === "owner" ? "Owner" : "Member"}
                </Badge>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
