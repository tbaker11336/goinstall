import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts connected-service tokens (Xero, Google) before they're stored.
 * The key is INTEGRATION_TOKEN_KEY (any long random string); in local
 * development and tests a fixed key is used so nothing needs setting up.
 */
function key(): Buffer {
  const raw = process.env.INTEGRATION_TOKEN_KEY;
  if (!raw) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") throw new Error("Set INTEGRATION_TOKEN_KEY to connect Xero or Google Calendar.");
    return createHash("sha256").update("goinstall-dev-integration-key").digest();
  }
  return createHash("sha256").update(raw).digest();
}

export function tokenKeyConfigured() {
  return Boolean(process.env.INTEGRATION_TOKEN_KEY) || !(process.env.VERCEL || process.env.NODE_ENV === "production");
}

export function sealTokens(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

export function openTokens<T>(sealed: string): T {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv!);
  d.setAuthTag(tag!);
  return JSON.parse(Buffer.concat([d.update(body!), d.final()]).toString("utf8")) as T;
}
