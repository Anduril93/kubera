// server-only: holds the RESEND_API_KEY — must never reach a client bundle.
import "server-only";

import { Resend } from "resend";
import type { EmailContent } from "@/lib/emails";

let client: Resend | null = null;

function getResend(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set.");
    client = new Resend(apiKey);
  }
  return client;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
}

/**
 * Send a transactional email built from one of the `emails.ts` templates.
 * Logs and returns { ok: false } on failure rather than throwing, so callers
 * (registration, invites) don't break the user flow on a mail hiccup.
 */
export async function sendEmail(
  to: string,
  content: EmailContent
): Promise<SendEmailResult> {
  const from = process.env.FROM_EMAIL;
  if (!from) {
    console.error("[resend] FROM_EMAIL is not set.");
    return { ok: false };
  }

  try {
    const { data, error } = await getResend().emails.send({
      from,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    if (error) {
      console.error("[resend] send failed", error);
      return { ok: false };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error("[resend] send threw", err);
    return { ok: false };
  }
}
