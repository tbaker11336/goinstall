/**
 * Text messages through Twilio, white-labelled: each company that buys the
 * SMS add-on gets a Twilio subaccount and its own UK number. GoInstall holds
 * one master account; the app depends only on these interfaces.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SendResult } from "./email";

export interface OutgoingSms {
  /** The company's subaccount; texts are billed to it. */
  accountSid: string;
  from: string;
  to: string;
  body: string;
  /** Twilio posts delivery updates here. */
  statusCallback?: string;
}

export interface SmsSender {
  readonly name: string;
  send(sms: OutgoingSms): Promise<SendResult>;
}

export interface SmsNumbers {
  /** A subaccount per company keeps its numbers and usage apart. */
  createSubaccount(friendlyName: string): Promise<{ sid: string }>;
  /** UK mobile numbers that can send and receive texts. */
  availableNumbers(opts?: { contains?: string; limit?: number }): Promise<{ phoneNumber: string; locality: string | null }[]>;
  /**
   * Buy a number into the company's subaccount. UK numbers need an approved
   * regulatory bundle (and address) for that business: GoInstall completes
   * that in Twilio before buying.
   */
  buyNumber(opts: { subaccountSid: string; phoneNumber: string; bundleSid: string; addressSid?: string; smsUrl: string }): Promise<{ sid: string; phoneNumber: string }>;
  releaseNumber(opts: { subaccountSid: string; numberSid: string }): Promise<void>;
}

export interface TwilioOptions {
  accountSid: string;
  authToken: string;
  fetch?: typeof fetch;
}

const API = "https://api.twilio.com/2010-04-01";

export function createTwilio({ accountSid, authToken, fetch: fetchImpl = fetch }: TwilioOptions): SmsSender & SmsNumbers {
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  async function call<T>(method: "GET" | "POST" | "DELETE", path: string, form?: Record<string, string | undefined>): Promise<T> {
    const body = form ? new URLSearchParams(Object.entries(form).filter((e): e is [string, string] => e[1] !== undefined)) : undefined;
    const res = await fetchImpl(`${API}${path}`, { method, headers: { Authorization: auth, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, body });
    if (method === "DELETE" && res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as T & { message?: string; code?: number };
    if (!res.ok) throw Object.assign(new Error(`Twilio: ${json.message ?? res.status}${json.code ? ` (${json.code})` : ""}`), { status: res.status });
    return json;
  }
  return {
    name: "twilio",
    async send(sms) {
      try {
        const r = await call<{ sid: string }>("POST", `/Accounts/${sms.accountSid}/Messages.json`, { To: sms.to, From: sms.from, Body: sms.body, StatusCallback: sms.statusCallback });
        return { ok: true, providerId: r.sid };
      } catch (e) {
        const status = (e as { status?: number }).status ?? 0;
        return { ok: false, error: (e as Error).message, retryable: status === 429 || status >= 500 };
      }
    },
    async createSubaccount(friendlyName) {
      const r = await call<{ sid: string }>("POST", "/Accounts.json", { FriendlyName: friendlyName.slice(0, 64) });
      return { sid: r.sid };
    },
    async availableNumbers({ contains, limit = 10 } = {}) {
      const q = new URLSearchParams({ SmsEnabled: "true", PageSize: String(limit), ...(contains ? { Contains: contains } : {}) });
      const r = await call<{ available_phone_numbers?: { phone_number: string; locality?: string | null }[] }>("GET", `/Accounts/${accountSid}/AvailablePhoneNumbers/GB/Mobile.json?${q}`);
      return (r.available_phone_numbers ?? []).map((n) => ({ phoneNumber: n.phone_number, locality: n.locality ?? null }));
    },
    async buyNumber({ subaccountSid, phoneNumber, bundleSid, addressSid, smsUrl }) {
      const r = await call<{ sid: string; phone_number: string }>("POST", `/Accounts/${subaccountSid}/IncomingPhoneNumbers.json`, { PhoneNumber: phoneNumber, BundleSid: bundleSid, AddressSid: addressSid, SmsUrl: smsUrl, SmsMethod: "POST" });
      return { sid: r.sid, phoneNumber: r.phone_number };
    },
    async releaseNumber({ subaccountSid, numberSid }) {
      await call("DELETE", `/Accounts/${subaccountSid}/IncomingPhoneNumbers/${numberSid}.json`);
    },
  };
}

/**
 * Twilio's webhook signature: HMAC-SHA1 (auth token) of the full URL followed
 * by each POST parameter name and value, sorted by name; base64.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Development and tests: texts are recorded (to a callback, e.g. a file), never sent. */
export function createRecordingSms(record: (sms: OutgoingSms & { at: string }) => Promise<void> | void): SmsSender & SmsNumbers {
  let n = 0;
  return {
    name: "recording",
    async send(sms) {
      await record({ ...sms, at: new Date().toISOString() });
      return { ok: true, providerId: `SMfake${++n}` };
    },
    async createSubaccount() {
      return { sid: `ACfake${Date.now()}` };
    },
    async availableNumbers() {
      return [{ phoneNumber: "+447700900001", locality: null }, { phoneNumber: "+447700900002", locality: null }];
    },
    async buyNumber({ phoneNumber }) {
      return { sid: `PNfake${phoneNumber.slice(-4)}`, phoneNumber };
    },
    async releaseNumber() {},
  };
}
