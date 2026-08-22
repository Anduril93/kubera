"use client";

import { useActionState } from "react";
import { Coins } from "lucide-react";

import { createHousehold, joinHousehold } from "@/lib/household-actions";
import type { HouseholdFormState } from "@/lib/validations/household";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const INITIAL: HouseholdFormState = {};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

export function Onboarding() {
  const [createState, createAction, creating] = useActionState(
    createHousehold,
    INITIAL
  );
  const [joinState, joinAction, joining] = useActionState(joinHousehold, INITIAL);

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-2 text-center">
        <div className="flex items-center justify-center gap-2 font-semibold">
          <Coins className="size-5 text-primary" />
          <span>Roundtable Finance</span>
        </div>
        <CardTitle className="text-xl">Set up your household</CardTitle>
        <CardDescription>
          Create a new household, or join your partner&rsquo;s with their invite
          code.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="create">
          <TabsList className="w-full">
            <TabsTrigger value="create" className="flex-1">
              Create
            </TabsTrigger>
            <TabsTrigger value="join" className="flex-1">
              Join
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create">
            <form action={createAction} className="grid gap-4 pt-2">
              <div className="grid gap-2">
                <Label htmlFor="name">Household name</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="The Smith Household"
                  required
                  autoFocus
                />
              </div>
              <FieldError message={createState.error} />
              <Button type="submit" disabled={creating}>
                {creating ? "Creating…" : "Create household"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="join">
            <form action={joinAction} className="grid gap-4 pt-2">
              <div className="grid gap-2">
                <Label htmlFor="invite_code">Invite code</Label>
                <Input
                  id="invite_code"
                  name="invite_code"
                  placeholder="ABCD2345"
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="font-mono tracking-widest uppercase"
                  required
                />
              </div>
              <FieldError message={joinState.error} />
              <Button type="submit" disabled={joining}>
                {joining ? "Joining…" : "Join household"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
