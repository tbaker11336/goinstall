import type { XeroAccount, XeroTaxRate } from "@goinstall/integrations";
import { ActionForm, SubmitButton } from "@/components/forms";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { saveXeroSettingsAction } from "@/lib/actions/xero";
import { asUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { xeroConfigured, xeroConnection, type XeroSettings } from "@/lib/xero";
import { XeroActions } from "./xero-client";

export const metadata = { title: "Integrations" };

const NOTICES: Record<string, { tone: "ok" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Xero is connected. Choose the accounts and tax rates below, then send your invoices." },
  cancelled: { tone: "bad", text: "Xero wasn't connected: the sign-in was cancelled." },
  expired: { tone: "bad", text: "That Xero sign-in had expired. Please try again." },
  failed: { tone: "bad", text: "Xero didn't accept the connection. Please try again." },
  "no-organisation": { tone: "bad", text: "That Xero login has no organisation to connect." },
  "not-configured": { tone: "bad", text: "Xero isn't set up on this server yet (XERO_CLIENT_ID, XERO_CLIENT_SECRET and INTEGRATION_TOKEN_KEY)." },
};

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ xero?: string }> }) {
  const { xero: notice } = await searchParams;
  const data = await asUser(
    async (tx, session) => {
      const [row, company, rates] = await Promise.all([
        tx.selectFrom("integrations").select(["status", "settings"]).where("provider", "=", "xero").where("user_id", "is", null).executeTakeFirst(),
        tx.selectFrom("companies").select("vat_rates").where("id", "=", session.companyId).executeTakeFirstOrThrow(),
        tx.selectFrom("proposal_lines").select("vat_rate").distinct().execute(),
        ]);
      const counts = await tx
        .selectFrom("invoices")
        .select((eb) => [eb.fn.countAll<number>().as("all"), eb.fn.count<number>("xero_invoice_id").as("synced"), eb.fn.count<number>("xero_error").as("errors")])
        .where("status", "in", ["open", "paid"])
        .executeTakeFirstOrThrow();
      return { row, vat: company.vat_rates as Record<string, number> | null, lineRates: rates.map((r) => Number(r.vat_rate)), counts, companyId: session.companyId };
    },
    ["admin"],
  );
  const connected = data.row?.status === "connected";
  const s = connected ? (data.row!.settings as unknown as XeroSettings) : null;
  // The VAT rates your invoices use, each needing a Xero tax rate.
  const rates = [...new Set([...Object.values(data.vat ?? {}), ...data.lineRates].map(Number).filter((n) => Number.isFinite(n)))].sort((a, b) => b - a);
  let accounts: XeroAccount[] = [];
  let taxRates: XeroTaxRate[] = [];
  let loadError: string | null = null;
  if (connected) {
    try {
      const conn = await xeroConnection(data.companyId);
      if (conn) [accounts, taxRates] = await Promise.all([conn.client.accounts(), conn.client.taxRates()]);
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Xero didn't respond";
    }
  }
  const sales = accounts.filter((a) => (a.type === "REVENUE" || a.type === "SALES") && a.code);
  const banks = accounts.filter((a) => a.type === "BANK" || a.enablePayments);
  const n = NOTICES[notice ?? ""];

  return (
    <div className="grid max-w-3xl gap-6">
      {n && (
        <p role="status" className={n.tone === "ok" ? "rounded-md bg-success-tint px-4 py-3 text-sm font-semibold text-success-text" : "rounded-md bg-red-50 px-4 py-3 text-sm text-red-900"}>
          {n.text}
        </p>
      )}
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Xero</CardTitle>
          <p className="text-sm text-ink-3">Invoices go to Xero when they&apos;re raised, with payments and voids; payments made in Xero come back here each morning (or when you check).</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!connected ? (
            xeroConfigured() ? (
              <a href="/api/integrations/xero/connect" className={buttonVariants({ className: "w-fit" })}>
                Connect Xero
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">Xero isn&apos;t set up on this server yet. It needs the Xero app&apos;s client ID and secret (XERO_CLIENT_ID, XERO_CLIENT_SECRET) and INTEGRATION_TOKEN_KEY in the environment settings.</p>
            )
          ) : (
            <>
              <p className="text-sm">
                Connected to <strong>{s!.tenantName}</strong>. {data.counts.synced} of {data.counts.all} invoices are in Xero
                {Number(data.counts.errors) ? `; ${data.counts.errors} need attention (see the Invoices tab)` : ""}.
                {s!.lastCheckedAt ? ` Payments last checked ${formatDateTime(s!.lastCheckedAt)}.` : ""}
              </p>
              {loadError ? (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
                  Couldn&apos;t load your Xero accounts: {loadError}. Try disconnecting and connecting again.
                </p>
              ) : (
                <ActionForm action={saveXeroSettingsAction} className="grid gap-4 sm:grid-cols-2">
                  {s!.tenants.length > 1 ? (
                    <Field label="Organisation" htmlFor="tenant_id" className="sm:col-span-2">
                      <Select id="tenant_id" name="tenant_id" defaultValue={s!.tenantId}>
                        {s!.tenants.map((t) => (
                          <option key={t.tenantId} value={t.tenantId}>
                            {t.tenantName}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : (
                    <input type="hidden" name="tenant_id" value={s!.tenantId} />
                  )}
                  <Field label="Sales account" htmlFor="sales_account" hint="Where invoice income goes.">
                    <Select id="sales_account" name="sales_account" defaultValue={s!.salesAccountCode ?? ""} aria-describedby="sales_account-hint">
                      <option value="">Choose…</option>
                      {sales.map((a) => (
                        <option key={a.accountId} value={a.code!}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Invoices in Xero are" htmlFor="invoice_status">
                    <Select id="invoice_status" name="invoice_status" defaultValue={s!.invoiceStatus}>
                      <option value="AUTHORISED">Approved</option>
                      <option value="DRAFT">Draft (approve them in Xero)</option>
                    </Select>
                  </Field>
                  <Field label="Bank transfers go to" htmlFor="payment_account" hint="Payments you record here are added in Xero against this account.">
                    <Select id="payment_account" name="payment_account" defaultValue={s!.paymentAccountId ?? ""} aria-describedby="payment_account-hint">
                      <option value="">Don&apos;t send payments</option>
                      {banks.map((a) => (
                        <option key={a.accountId} value={a.accountId}>
                          {a.code ? `${a.code} · ` : ""}
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Card payments go to" htmlFor="card_account" hint="e.g. a Stripe clearing account. Uses the bank transfer account when not set.">
                    <Select id="card_account" name="card_account" defaultValue={s!.cardAccountId ?? ""} aria-describedby="card_account-hint">
                      <option value="">Same as bank transfers</option>
                      {banks.map((a) => (
                        <option key={a.accountId} value={a.accountId}>
                          {a.code ? `${a.code} · ` : ""}
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                    <legend className="mb-1.5 text-sm font-medium">Xero tax rate for each VAT rate you use</legend>
                    {rates.length === 0 && <p className="text-sm text-muted-foreground">Set your VAT rates in Settings › Invoices &amp; quotes first.</p>}
                    {rates.map((r) => (
                      <Field key={r} label={`${r}% VAT`} htmlFor={`tax_${r}`}>
                        <Select id={`tax_${r}`} name={`tax_${r}`} defaultValue={s!.taxTypes[String(r)] ?? ""}>
                          <option value="">Choose…</option>
                          {taxRates
                            .filter((t) => t.revenue)
                            .map((t) => (
                              <option key={t.taxType} value={t.taxType}>
                                {t.name} ({t.rate}%)
                              </option>
                            ))}
                        </Select>
                      </Field>
                    ))}
                  </fieldset>
                  <div className="sm:col-span-2">
                    <SubmitButton>Save Xero settings</SubmitButton>
                  </div>
                </ActionForm>
              )}
              <XeroActions />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
