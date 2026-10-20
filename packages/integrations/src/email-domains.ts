/**
 * Sending domains: each company verifies its own domain with the email
 * provider by adding DNS records, then email goes out from its address.
 */

export type DomainStatus = "not_started" | "pending" | "verified" | "failed" | "temporary_failure";

export interface DnsRecord {
  /** What the record is for, e.g. "SPF", "DKIM", "MX". */
  purpose: string;
  type: string;
  name: string;
  value: string;
  priority?: number;
  ttl?: string;
  status?: string;
}

export interface SendingDomain {
  id: string;
  name: string;
  status: DomainStatus;
  records: DnsRecord[];
}

export interface EmailDomains {
  readonly name: string;
  create(domain: string): Promise<SendingDomain>;
  get(id: string): Promise<SendingDomain>;
  /** Ask the provider to check the DNS records now. */
  verify(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

interface ResendDomain {
  id: string;
  name: string;
  status: string;
  records?: { record: string; name: string; type: string; ttl?: string; status?: string; value: string; priority?: number }[];
}

const STATUSES: DomainStatus[] = ["not_started", "pending", "verified", "failed", "temporary_failure"];
const toDomain = (d: ResendDomain): SendingDomain => ({
  id: d.id,
  name: d.name,
  status: (STATUSES as string[]).includes(d.status) ? (d.status as DomainStatus) : "pending",
  records: (d.records ?? []).map((r) => ({ purpose: r.record, type: r.type, name: r.name, value: r.value, priority: r.priority, ttl: r.ttl, status: r.status })),
});

/** https://resend.com/docs/api-reference/domains (needs a full-access API key). */
export function createResendDomains({ apiKey, fetch: fetchImpl = fetch, baseUrl = "https://api.resend.com", region = "eu-west-1" }: { apiKey: string; fetch?: typeof fetch; baseUrl?: string; region?: string }): EmailDomains {
  async function call<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw new Error(json.message ?? `Resend returned ${res.status}`);
    return json;
  }
  return {
    name: "resend",
    create: async (domain) => toDomain(await call<ResendDomain>("/domains", { method: "POST", body: { name: domain, region } })),
    get: async (id) => toDomain(await call<ResendDomain>(`/domains/${encodeURIComponent(id)}`, { method: "GET" })),
    verify: async (id) => void (await call(`/domains/${encodeURIComponent(id)}/verify`, { method: "POST" })),
    remove: async (id) => void (await call(`/domains/${encodeURIComponent(id)}`, { method: "DELETE" })),
  };
}

/** For development and tests: records look real; a domain verifies on the first check. */
export function createFakeDomains(): EmailDomains {
  const domains = new Map<string, SendingDomain & { checks: number }>();
  return {
    name: "fake",
    async create(name) {
      const id = `dom_${name.replace(/\W/g, "_")}`;
      const d = {
        id,
        name,
        status: "not_started" as DomainStatus,
        checks: 0,
        records: [
          { purpose: "SPF", type: "MX", name: `send.${name}`, value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10 },
          { purpose: "SPF", type: "TXT", name: `send.${name}`, value: '"v=spf1 include:amazonses.com ~all"' },
          { purpose: "DKIM", type: "TXT", name: `resend._domainkey.${name}`, value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDexample" },
        ],
      };
      domains.set(id, d);
      return d;
    },
    async get(id) {
      const d = domains.get(id);
      if (!d) throw new Error("Domain not found");
      return d;
    },
    async verify(id) {
      const d = domains.get(id);
      if (!d) throw new Error("Domain not found");
      d.checks++;
      d.status = "verified";
    },
    async remove(id) {
      domains.delete(id);
    },
  };
}
