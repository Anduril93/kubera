// server-only: Cloudflare R2 (S3-compatible) client + signed-URL helpers.
// The bucket is PRIVATE — the only access is via short-lived signed URLs
// generated here. No public bucket URL is ever constructed.
import "server-only";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Thrown when R2 env vars aren't set — callers turn this into a friendly message. */
export class R2NotConfiguredError extends Error {
  constructor() {
    super("R2 storage is not configured.");
    this.name = "R2NotConfiguredError";
  }
}

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function readConfig(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function isR2Configured(): boolean {
  return readConfig() !== null;
}

let cached: { client: S3Client; bucket: string } | null = null;

function getClient(): { client: S3Client; bucket: string } {
  const cfg = readConfig();
  if (!cfg) throw new R2NotConfiguredError();
  if (!cached) {
    cached = {
      bucket: cfg.bucket,
      client: new S3Client({
        region: "auto",
        endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      }),
    };
  }
  return cached;
}

/** Object key for a receipt, namespaced under the household (never a URL). */
export function receiptKey(householdId: string, ext: string): string {
  return `receipts/${householdId}/${crypto.randomUUID()}.${ext}`;
}

export async function uploadToR2(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function getR2Object(
  key: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { client, bucket } = getClient();
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  const bytes = await res.Body!.transformToByteArray();
  return {
    bytes,
    contentType: res.ContentType ?? "application/octet-stream",
  };
}

/** A short-lived (default 5 min) signed GET URL for a private object. */
export async function getSignedR2Url(
  key: string,
  expiresInSeconds = 300
): Promise<string> {
  const { client, bucket } = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds }
  );
}

export async function deleteFromR2(key: string): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
