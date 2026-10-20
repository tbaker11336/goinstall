import "server-only";
import { appendFile } from "node:fs/promises";
import { createFakeDomains, createRecordingSender, createResendDomains, createResendSender, type EmailDomains, type EmailSender } from "@goinstall/integrations";

const g = globalThis as unknown as { goinstallEmail?: EmailSender; goinstallDomains?: EmailDomains };

/**
 * Resend when RESEND_API_KEY and EMAIL_FROM are set; otherwise emails are
 * recorded (and appended to EMAIL_OUTBOX_FILE if set) instead of sent, so
 * local development and tests never email real customers.
 */
export function emailSender(): EmailSender {
  if (g.goinstallEmail) return g.goinstallEmail;
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey && process.env.EMAIL_FROM) {
    g.goinstallEmail = createResendSender({ apiKey });
  } else {
    const outbox = process.env.EMAIL_OUTBOX_FILE;
    g.goinstallEmail = createRecordingSender({
      onSend: async (email) => {
        if (outbox) await appendFile(outbox, `${JSON.stringify({ ...email, attachments: email.attachments?.map((a) => a.filename), at: new Date().toISOString() })}\n`);
        else console.info(`[email not sent: no RESEND_API_KEY] to ${email.to}: ${email.subject}`);
      },
    });
  }
  return g.goinstallEmail;
}

/** True when emails really go out (shown in the console so staff know). */
export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * From address for a company. Once the company has verified its own domain,
 * email goes from that address (`sender`, e.g. hello@brightside.co.uk);
 * until then, the platform's verified address (EMAIL_FROM) with the
 * company's name.
 */
export function fromAddress(companyName: string, sender?: string | null) {
  const configured = process.env.EMAIL_FROM ?? "GoInstall <no-reply@localhost>";
  const address = sender || (configured.match(/<([^>]+)>/)?.[1] ?? configured.trim());
  const name = companyName.replace(/["<>]/g, "").trim();
  return `"${name}" <${address}>`;
}

/** Sending-domain management: Resend when configured, otherwise a stand-in for development. */
export function emailDomains(): EmailDomains | null {
  if (g.goinstallDomains) return g.goinstallDomains;
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) g.goinstallDomains = createResendDomains({ apiKey });
  else if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) g.goinstallDomains = createFakeDomains();
  else return null;
  return g.goinstallDomains;
}
