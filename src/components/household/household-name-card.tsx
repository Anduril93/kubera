"use client";

import { useActionState } from "react";

import { renameHousehold } from "@/lib/household-actions";
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

const INITIAL: HouseholdFormState = {};

export function HouseholdNameCard({
  name,
  isOwner,
}: {
  name: string;
  isOwner: boolean;
}) {
  const [state, action, pending] = useActionState(renameHousehold, INITIAL);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Household name</CardTitle>
        <CardDescription>
          {isOwner
            ? "Rename your household."
            : "Only the household owner can change this."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isOwner ? (
          <form action={action} className="flex flex-col gap-3 sm:flex-row">
            <Input
              name="name"
              defaultValue={name}
              required
              maxLength={60}
              aria-label="Household name"
            />
            <Button type="submit" disabled={pending} className="sm:w-28">
              {pending ? "Saving…" : "Save"}
            </Button>
          </form>
        ) : (
          <p className="text-lg font-medium">{name}</p>
        )}
        {state.error ? (
          <p role="alert" className="text-destructive mt-2 text-sm">
            {state.error}
          </p>
        ) : null}
        {state.success ? (
          <p className="text-muted-foreground mt-2 text-sm">Saved.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
