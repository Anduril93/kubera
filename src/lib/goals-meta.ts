import { differenceInCalendarDays, format, parseISO } from "date-fns";

/**
 * Savings-goal display types + progress/pace math. Pure module (no server-only
 * imports) so client components can use it.
 *
 * Progress mode is ALWAYS explicit: a goal is either "linked" (progress = its
 * account's balance) or "manual" (progress = current_amount_cents).
 */

export type GoalMode = "linked" | "manual";

export interface GoalAccountRef {
  id: string;
  name: string;
  current_balance_cents: number;
  currency: string;
}

/** A row from savings_goals (+ linked account when set). */
export interface SavingsGoal {
  id: string;
  name: string;
  target_amount_cents: number;
  target_date: string | null;
  linked_account_id: string | null;
  current_amount_cents: number;
  color: string | null;
  icon: string | null;
  created_at: string;
  linked_account: GoalAccountRef | null;
}

export type GoalPaceStatus = "on_pace" | "behind" | "past_due" | "complete";

export interface GoalPace {
  status: GoalPaceStatus;
  targetDate: string;
}

export interface GoalWithProgress {
  goal: SavingsGoal;
  mode: GoalMode;
  /** Name of the linked account (mode === "linked"); null for manual. */
  linkedAccountName: string | null;
  currency: string;
  currentCents: number;
  targetCents: number;
  /** 0–100+ (can exceed 100 when over the target). */
  percentComplete: number;
  remainingCents: number;
  isComplete: boolean;
  /** null when the goal has no target_date. */
  pace: GoalPace | null;
}

export const GOAL_PACE_LABELS: Record<GoalPaceStatus, string> = {
  on_pace: "On pace",
  behind: "Behind",
  past_due: "Past due",
  complete: "Complete",
};

/**
 * Resolve a goal against its live inputs. `currentCents` is already the
 * mode-appropriate value (the caller picks account balance vs manual amount).
 */
export function computeGoalProgress(params: {
  mode: GoalMode;
  currentCents: number;
  targetCents: number;
  createdAt: string;
  targetDate: string | null;
  today: Date;
}): {
  percentComplete: number;
  remainingCents: number;
  isComplete: boolean;
  pace: GoalPace | null;
} {
  const { currentCents, targetCents, createdAt, targetDate, today } = params;

  const percentComplete =
    targetCents > 0
      ? Math.round((currentCents / targetCents) * 100)
      : currentCents > 0
        ? 100
        : 0;
  const remainingCents = Math.max(0, targetCents - currentCents);
  const isComplete = targetCents > 0 && currentCents >= targetCents;

  let pace: GoalPace | null = null;
  if (targetDate) {
    if (isComplete) {
      pace = { status: "complete", targetDate };
    } else {
      const todayYmd = format(today, "yyyy-MM-dd");
      if (todayYmd > targetDate) {
        pace = { status: "past_due", targetDate };
      } else {
        // On pace if progress fraction ≥ elapsed-time fraction.
        const start = parseISO(createdAt.slice(0, 10));
        const end = parseISO(targetDate);
        const now = parseISO(todayYmd);
        const total = differenceInCalendarDays(end, start);
        const elapsed = differenceInCalendarDays(now, start);
        const timeFraction =
          total > 0 ? Math.min(Math.max(elapsed / total, 0), 1) : 1;
        const progressFraction = targetCents > 0 ? currentCents / targetCents : 0;
        pace = {
          status: progressFraction >= timeFraction ? "on_pace" : "behind",
          targetDate,
        };
      }
    }
  }

  return { percentComplete, remainingCents, isComplete, pace };
}
