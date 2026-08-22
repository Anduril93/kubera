/**
 * Same-origin redirect sanitizer. Use on any user-controlled redirect target
 * (e.g. the `?redirect=` param set by the proxy) to prevent open redirects.
 * Pure module — safe on client and server.
 *
 * Only same-origin, path-absolute targets pass. Anything else falls back.
 */

const DEFAULT_FALLBACK = "/dashboard";

export function getSafeRedirect(
  target: string | null | undefined,
  fallback: string = DEFAULT_FALLBACK
): string {
  if (!target || typeof target !== "string") return fallback;

  const trimmed = target.trim();

  // Must be a path-absolute URL ("/...").
  if (!trimmed.startsWith("/")) return fallback;

  // Reject protocol-relative ("//evil.com") and backslash tricks ("/\evil.com").
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return fallback;

  // Reject anything that smuggles a scheme/control characters.
  if (/[\x00-\x1f]/.test(trimmed)) return fallback;
  if (trimmed.includes("://")) return fallback;

  return trimmed;
}
