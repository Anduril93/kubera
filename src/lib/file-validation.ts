/**
 * Magic-byte file type detection for uploads. NEVER trust a client-supplied
 * `file.type` / extension — sniff the actual bytes. Pure module (operates on
 * raw bytes), safe to import on client or server.
 *
 * Allowed for receipts/statements: JPEG, PNG, WebP, PDF.
 */

export type DetectedFileKind = "jpeg" | "png" | "webp" | "pdf";

export interface DetectedFileType {
  kind: DetectedFileKind;
  mime: string;
  ext: string;
}

const SIGNATURES: Record<DetectedFileKind, { mime: string; ext: string }> = {
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  png: { mime: "image/png", ext: "png" },
  webp: { mime: "image/webp", ext: "webp" },
  pdf: { mime: "application/pdf", ext: "pdf" },
};

export const ALLOWED_UPLOAD_MIME_TYPES = Object.values(SIGNATURES).map(
  (s) => s.mime
);

function toBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Returns the detected type, or null if the bytes don't match an allowed type.
 */
export function detectFileType(
  input: ArrayBuffer | Uint8Array
): DetectedFileType | null {
  const bytes = toBytes(input);

  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "jpeg", ...SIGNATURES.jpeg };

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { kind: "png", ...SIGNATURES.png };

  // WebP: "RIFF" .... "WEBP" (RIFF at 0, WEBP at 8)
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return { kind: "webp", ...SIGNATURES.webp };

  // PDF: 25 50 44 46 ("%PDF")
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: "pdf", ...SIGNATURES.pdf };

  return null;
}
