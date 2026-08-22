/**
 * Small disposable / throwaway email domain blocklist. Not exhaustive — a
 * lightweight first filter for registration. Pure module, safe on client and
 * server. Expand as needed.
 */

export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "sharklasers.com",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "trashmail.com",
  "getnada.com",
  "yopmail.com",
  "dispostable.com",
  "fakeinbox.com",
  "maildrop.cc",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "spam4.me",
  "tutanota-temp.com",
  "emailondeck.com",
  "moakt.com",
  "tempinbox.com",
  "discard.email",
]);

/** Accepts a full email or a bare domain. */
export function isDisposable(emailOrDomain: string): boolean {
  if (!emailOrDomain) return false;
  const domain = emailOrDomain.includes("@")
    ? emailOrDomain.split("@").pop() ?? ""
    : emailOrDomain;
  return DISPOSABLE_DOMAINS.has(domain.trim().toLowerCase());
}
