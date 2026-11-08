import { describe, expect, it, vi } from "vitest";
import { createXeroAuth, createXeroClient, XeroError } from "./accounting";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Xero adapter", () => {
  it("sends an approved invoice with our number, a line per VAT rate, the tenant and an idempotency key", async () => {
    const fetch = vi.fn(async () => json({ Invoices: [{ InvoiceID: "x-1" }] }));
    const xero = createXeroClient({ accessToken: "tok", tenantId: "ten", fetch });
    const r = await xero.upsertInvoice(
      {
        number: "BSE-INV-0007",
        reference: "Quote BSE-0002",
        contact: { name: "Grace Okafor", email: "grace@example.com" },
        date: "2026-11-08",
        dueDate: "2026-11-22",
        status: "AUTHORISED",
        lines: [
          { description: "Stage payment (solar)", netPence: 100_000, vatPence: 0, accountCode: "200", taxType: "ZERORATEDOUTPUT" },
          { description: "Stage payment (EV)", netPence: 50_000, vatPence: 10_000, accountCode: "200", taxType: "OUTPUT2" },
        ],
      },
      null,
      "inv-1",
    );
    expect(r).toEqual({ invoiceId: "x-1" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.xero.com/api.xro/2.0/Invoices?summarizeErrors=false");
    expect(init.headers).toMatchObject({ "xero-tenant-id": "ten", Authorization: "Bearer tok", "Idempotency-Key": "inv-1" });
    const body = JSON.parse(String(init.body)).Invoices[0];
    expect(body).toMatchObject({ Type: "ACCREC", InvoiceNumber: "BSE-INV-0007", Status: "AUTHORISED", LineAmountTypes: "Exclusive", Contact: { Name: "Grace Okafor", EmailAddress: "grace@example.com" } });
    expect(body.LineItems).toEqual([
      { Description: "Stage payment (solar)", Quantity: 1, UnitAmount: 1000, AccountCode: "200", TaxType: "ZERORATEDOUTPUT", TaxAmount: 0 },
      { Description: "Stage payment (EV)", Quantity: 1, UnitAmount: 500, AccountCode: "200", TaxType: "OUTPUT2", TaxAmount: 100 },
    ]);
  });

  it("turns Xero's validation errors into a readable message", async () => {
    const fetch = vi.fn(async () => json({ Elements: [{ ValidationErrors: [{ Message: "Account code '999' is not a valid code" }] }] }, 400));
    const xero = createXeroClient({ accessToken: "t", tenantId: "t", fetch });
    await expect(xero.voidInvoice("x", false)).rejects.toThrow(new XeroError("Account code '999' is not a valid code", 400));
  });

  it("reads invoice payments back in pence with plain dates", async () => {
    const fetch = vi.fn(async () => json({ Invoices: [{ InvoiceID: "x-1", Status: "PAID", AmountPaid: 600.5, Payments: [{ PaymentID: "p-1", Amount: 600.5, Date: "/Date(1762560000000+0000)/" }] }] }));
    const xero = createXeroClient({ accessToken: "t", tenantId: "t", fetch });
    expect(await xero.invoices(["x-1"])).toEqual([{ invoiceId: "x-1", status: "PAID", amountPaidPence: 60_050, payments: [{ paymentId: "p-1", amountPence: 60_050, date: "2025-11-08" }] }]);
  });

  it("builds the sign-in link and exchanges the code for tokens", async () => {
    const fetch = vi.fn(async () => json({ access_token: "a", refresh_token: "r", expires_in: 1800 }));
    const auth = createXeroAuth({ clientId: "cid", clientSecret: "sec", redirectUri: "https://app.example/cb", fetch });
    const url = new URL(auth.authorizeUrl("st"));
    expect(url.origin + url.pathname).toBe("https://login.xero.com/identity/connect/authorize");
    expect(url.searchParams.get("scope")).toContain("accounting.invoices");
    expect(url.searchParams.get("state")).toBe("st");
    const t = await auth.exchangeCode("code");
    expect(t).toMatchObject({ accessToken: "a", refreshToken: "r" });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from("cid:sec").toString("base64")}` });
    expect(String(init.body)).toContain("grant_type=authorization_code");
  });
});
