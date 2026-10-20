/**
 * Outgoing email. The app depends only on EmailSender; Resend is one
 * implementation, and a recording sender is used in development and tests.
 */

export interface OutgoingEmail {
  /** "Brightside Solar <hello@mail.brightside.co.uk>" */
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  /** Stops a retried request sending the same email twice. */
  idempotencyKey?: string;
  tags?: Record<string, string>;
}

export type SendResult = { ok: true; providerId: string } | { ok: false; error: string; retryable: boolean };

export interface EmailSender {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SendResult>;
}

/** Plain-text body to simple, safe HTML: escaped, paragraphs and line breaks, links clickable. */
export function textToHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const linkify = (s: string) => s.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`);
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${linkify(escape(p)).replace(/\n/g, "<br>")}</p>`);
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#101828">${paragraphs.join("")}</div>`;
}

export interface ResendOptions {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** https://resend.com/docs/api-reference/emails/send-email */
export function createResendSender({ apiKey, fetch: fetchImpl = fetch, baseUrl = "https://api.resend.com" }: ResendOptions): EmailSender {
  return {
    name: "resend",
    async send(email) {
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
          },
          body: JSON.stringify({
            from: email.from,
            to: [email.to],
            reply_to: email.replyTo,
            subject: email.subject,
            text: email.text,
            html: email.html ?? textToHtml(email.text),
            tags: email.tags ? Object.entries(email.tags).map(([name, value]) => ({ name, value: value.replace(/[^A-Za-z0-9_-]/g, "_") })) : undefined,
          }),
        });
      } catch (err) {
        return { ok: false, error: `Could not reach Resend: ${err instanceof Error ? err.message : String(err)}`, retryable: true };
      }
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (res.ok && body.id) return { ok: true, providerId: body.id };
      return {
        ok: false,
        error: body.message ?? `Resend returned ${res.status}`,
        retryable: res.status === 429 || res.status >= 500,
      };
    },
  };
}

/**
 * Records emails instead of sending them: for local development, previews
 * and tests. Optionally appends each email as a JSON line to a file.
 */
export function createRecordingSender(opts: { onSend?: (email: OutgoingEmail) => void | Promise<void> } = {}): EmailSender & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    name: "recording",
    sent,
    async send(email) {
      sent.push(email);
      await opts.onSend?.(email);
      return { ok: true, providerId: `recorded-${sent.length}-${Date.now()}` };
    },
  };
}
