// server-only: holds per-process in-memory counters.
import "server-only";

/**
 * In-memory IP rate limiter for unauthenticated/abuse-prone endpoints (login,
 * register, search). State lives in this server process's memory — fine for a
 * single-instance personal app; swap for a shared store (Redis/Postgres) if
 * ever scaled horizontally.
 */

interface Bucket {
  count: number;
  resetAt: number; // epoch ms
}

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the map can't grow unbounded.
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface IPRateLimitResult {
  allowed: boolean;
  /** Attempts remaining in the current window. */
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
}

/**
 * Records one attempt for `key` and reports whether it's within `limit` per
 * `windowMs`. Compose a namespaced key, e.g. `login:${ip}`.
 */
export function checkIPRateLimit(
  key: string,
  limit: number,
  windowMs: number
): IPRateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);
  return {
    allowed: existing.count <= limit,
    remaining,
    resetAt: existing.resetAt,
  };
}

/** Login limiter: 5 attempts / 15 minutes / IP (CLAUDE.md › Security Rules). */
export function checkLoginRateLimit(ip: string): IPRateLimitResult {
  return checkIPRateLimit(`login:${ip}`, 5, 15 * 60 * 1000);
}
