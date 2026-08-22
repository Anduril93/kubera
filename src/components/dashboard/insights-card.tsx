import { Sparkles } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** Stub for the AI monthly summary (Phase 3). No AI call — visibly "coming soon". */
export function InsightsCard() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="text-primary size-4" />
          Monthly insights
        </CardTitle>
        <Badge variant="secondary">Coming soon</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          AI-written summaries of your spending trends, budget progress, and
          anomalies will appear here. This arrives with the AI features in a
          later phase.
        </p>
      </CardContent>
    </Card>
  );
}
