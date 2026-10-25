import "server-only";
import { verifyTwilioSignature } from "@goinstall/integrations";
import { env } from "./env";

/**
 * Read and verify a Twilio webhook (form-encoded, signed with the master
 * auth token over the public URL). Null when it isn't genuine. In local
 * development without Twilio, the recording stand-in skips the check.
 */
export async function twilioParams(request: Request, path: string): Promise<Record<string, string> | null> {
  const params = Object.fromEntries([...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]));
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return process.env.SMS_OUTBOX_FILE && process.env.NODE_ENV !== "production" && !process.env.VERCEL ? params : null;
  const url = `${env.siteUrl.replace(/\/$/, "")}${path}`;
  return verifyTwilioSignature(token, url, params, request.headers.get("x-twilio-signature")) ? params : null;
}

export const twiml = (message?: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${message.replace(/[<>&]/g, "")}</Message>` : ""}</Response>`, { headers: { "Content-Type": "text/xml" } });
