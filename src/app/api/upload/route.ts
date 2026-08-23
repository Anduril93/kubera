import { NextResponse } from "next/server";

import { getCurrentHousehold } from "@/lib/household";
import { detectFileType } from "@/lib/file-validation";
import {
  uploadToR2,
  receiptKey,
  isR2Configured,
  R2NotConfiguredError,
} from "@/lib/r2";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 8;

/**
 * Private receipt upload. Accepts JPEG/PNG/WebP/PDF, validated by MAGIC BYTES
 * (never the client-supplied file.type). Stores under a household-namespaced R2
 * key and returns the key(s) — never a URL (the bucket is private; access is
 * via short-lived signed URLs only).
 */
export async function POST(request: Request) {
  const household = await getCurrentHousehold();
  if (!household) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const files = form
    .getAll("file")
    .filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Too many files (max ${MAX_FILES}).` },
      { status: 400 }
    );
  }

  // Validate EVERYTHING by magic bytes before touching storage, so an invalid
  // file is rejected the same way whether or not R2 is configured.
  const validated: { bytes: Uint8Array; ext: string; mime: string }[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large (max 10 MB)." },
        { status: 400 }
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectFileType(bytes);
    if (!detected) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Upload a JPEG, PNG, WebP, or PDF receipt.",
        },
        { status: 400 }
      );
    }
    validated.push({ bytes, ext: detected.ext, mime: detected.mime });
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      { error: "Receipt uploads aren't configured." },
      { status: 503 }
    );
  }

  const keys: string[] = [];
  try {
    for (const v of validated) {
      const key = receiptKey(household.id, v.ext);
      await uploadToR2(key, v.bytes, v.mime);
      keys.push(key);
    }
  } catch (err) {
    if (err instanceof R2NotConfiguredError) {
      return NextResponse.json(
        { error: "Receipt uploads aren't configured." },
        { status: 503 }
      );
    }
    console.error("[upload] failed", err);
    return NextResponse.json(
      { error: "Upload failed. Enter the transaction manually." },
      { status: 500 }
    );
  }

  return NextResponse.json({ keys });
}
