/**
 * Transactional email templates. Pure functions that build subject + HTML +
 * text — no secrets, no Resend import, so this stays safe to unit-test and
 * import anywhere. The actual send happens in `src/lib/resend.ts` (server-only).
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const BRAND = "Roundtable Finance";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Minimal, email-client-safe wrapper. Inline styles only. */
function layout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px 28px 8px;font-size:18px;font-weight:600;">${escapeHtml(BRAND)}</td></tr>
      <tr><td style="padding:0 28px;"><h1 style="font-size:20px;margin:8px 0 12px;">${escapeHtml(heading)}</h1></td></tr>
      <tr><td style="padding:0 28px 28px;font-size:14px;line-height:1.6;color:#334155;">${bodyHtml}</td></tr>
    </table>
    <p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#94a3b8;text-align:center;">A private household finance app · This message was sent by ${escapeHtml(
      BRAND
    )}.</p>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(
    href
  )}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px;">${escapeHtml(
    label
  )}</a>`;
}

export function welcomeEmail(params: {
  name?: string;
  appUrl: string;
}): EmailContent {
  const { name, appUrl } = params;
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const subject = `Welcome to ${BRAND}`;
  const html = layout(
    `Welcome to ${BRAND}`,
    `<p>${escapeHtml(greeting)}</p>
     <p>Your account is ready. ${escapeHtml(
       BRAND
     )} keeps your household's income, expenses, budgets, bills, goals, and net worth in one private place.</p>
     <p style="margin:20px 0;">${button(appUrl, "Open your dashboard")}</p>
     <p>Everything stays private to your household.</p>`
  );
  const text = `${greeting}

Your ${BRAND} account is ready. Open your dashboard: ${appUrl}

Everything stays private to your household.`;
  return { subject, html, text };
}

export function householdInviteEmail(params: {
  inviterName?: string;
  householdName: string;
  inviteUrl: string;
  inviteCode: string;
}): EmailContent {
  const { inviterName, householdName, inviteUrl, inviteCode } = params;
  const who = inviterName ? escapeHtml(inviterName) : "Someone";
  const subject = `You're invited to join ${householdName} on ${BRAND}`;
  const html = layout(
    `Join ${escapeHtml(householdName)}`,
    `<p>${who} invited you to share the <strong>${escapeHtml(
      householdName
    )}</strong> household on ${escapeHtml(BRAND)}.</p>
     <p>You'll have full access to the household's finances.</p>
     <p style="margin:20px 0;">${button(inviteUrl, "Accept invitation")}</p>
     <p>Or enter this invite code after signing in:</p>
     <p style="font-size:18px;font-weight:700;letter-spacing:2px;font-family:monospace;">${escapeHtml(
       inviteCode
     )}</p>`
  );
  const text = `${who} invited you to join the "${householdName}" household on ${BRAND}.

Accept the invitation: ${inviteUrl}
Or use invite code: ${inviteCode}`;
  return { subject, html, text };
}
