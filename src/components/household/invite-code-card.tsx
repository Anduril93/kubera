"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { regenerateInviteCode } from "@/lib/household-actions";
import type { HouseholdFormState } from "@/lib/validations/household";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const INITIAL: HouseholdFormState = {};

export function InviteCodeCard({
  code,
  isOwner,
}: {
  code: string;
  isOwner: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState(regenerateInviteCode, INITIAL);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Invite code copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — copy it manually");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite code</CardTitle>
        <CardDescription>
          Share this code with your partner so they can join. There is no email
          invite — hand the code over directly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <code className="bg-muted flex-1 rounded-md px-3 py-2 font-mono text-lg tracking-[0.3em]">
            {code}
          </code>
          <Button variant="outline" size="icon" onClick={copy} aria-label="Copy invite code">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </div>

        {isOwner ? (
          <form action={action}>
            <Button type="submit" variant="secondary" size="sm" disabled={pending}>
              {pending ? "Regenerating…" : "Regenerate code"}
            </Button>
          </form>
        ) : null}

        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
