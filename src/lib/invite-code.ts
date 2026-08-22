/**
 * Invite-code generation. Codes are handed over directly by the owner (there is
 * no email in this app), so they should be short and unambiguous to read aloud
 * or type. Crockford-ish alphabet: no 0/O/1/I/L. Uses Web Crypto (available in
 * Node and edge runtimes).
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateInviteCode(length = 8): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
