import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { XERO_FILE } from "../playwright.config";
import { signInAs } from "./helpers";

// Xero (the stand-in): connect, choose accounts and tax rates, send the
// invoices raised so far, then a payment made "in Xero" comes back as paid.

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 1200 } });

type Fake = { invoices: Record<string, { input: { number: string; status: string; lines: { netPence: number; vatPence: number; taxType: string; accountCode: string }[] }; status: string; payments: { paymentId: string; amountPence: number; date: string; ours: boolean }[] }> };
const xero = () => JSON.parse(readFileSync(XERO_FILE, "utf8")) as Fake;
const byNumber = (n: string) => Object.entries(xero().invoices).find(([, v]) => v.input.number === n);

test("connect Xero, send invoices with payments, and read a payment back from Xero", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/settings/integrations");
  await page.getByRole("link", { name: "Connect Xero" }).click();
  await page.waitForURL(/xero=connected/);
  await expect(page.getByText("Connected to Demo Company (UK)")).toBeVisible();

  await page.getByLabel("Sales account").selectOption({ label: "200 · Sales" });
  await page.getByLabel("Bank transfers go to").selectOption({ label: "090 · Business Bank Account" });
  await page.getByLabel("Card payments go to").selectOption({ label: "091 · Stripe clearing" });
  const tax: Record<string, string> = { "20": "OUTPUT2", "5": "RROUTPUT", "0": "ZERORATEDOUTPUT" };
  for (const sel of await page.locator('select[name^="tax_"]').all()) {
    const rate = (await sel.getAttribute("name"))!.slice(4);
    await sel.selectOption(tax[rate] ?? { index: 1 });
  }
  await page.getByRole("button", { name: "Save Xero settings" }).click();
  await expect(page.getByText("Xero settings saved.")).toBeVisible();

  await page.getByRole("button", { name: "Send invoices to Xero now" }).click();
  await expect(page.getByText(/\d+ invoices? sent to Xero\./)).toBeVisible({ timeout: 30_000 });

  // Grace's invoices (phase 4, 6 and 9b) are in Xero, approved, with their payments.
  await page.goto("/invoices?show=all");
  const extra = page.getByRole("row", { name: /Grace Okafor/ }).filter({ hasText: "Extra work" }).filter({ hasText: "Paid" }).first();
  const number = (await extra.getByRole("link").first().textContent())!.trim();
  const [, inXero] = byNumber(number)!;
  expect(inXero.status).toBe("PAID");
  expect(inXero.input.lines).toEqual([{ description: expect.any(String), netPence: 25_000, vatPence: 5_000, accountCode: "200", taxType: "OUTPUT2" }]);
  expect(inXero.payments).toHaveLength(1);

  // A new invoice goes to Xero by itself when raised.
  await extra.getByRole("link").first().click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/invoices$/);
  await page.getByText("Extra work", { exact: true }).click();
  await page.getByLabel("Amount before VAT (£)").fill("100");
  await page.getByLabel("VAT rate (%)").fill("20");
  await page.getByLabel("Description").fill("Annual service visit");
  await page.getByLabel(/Email it to the customer now/).uncheck();
  await page.getByRole("button", { name: "Raise invoice" }).click();
  const row = page.getByTestId("invoice-row").filter({ hasText: "Annual service visit" });
  await expect(row).toContainText("Unpaid");
  const newNumber = (await row.locator("p").first().textContent())!.match(/\S+-INV-\d+/)![0];
  await expect.poll(() => Boolean(byNumber(newNumber)), { timeout: 20_000 }).toBe(true);
  await page.reload();
  await expect(page.getByTestId("invoice-row").filter({ hasText: "Annual service visit" }).getByTestId("xero-status")).toContainText("In Xero");

  // The customer pays it in Xero (bank feed); GoInstall picks it up.
  const state = xero();
  const [id] = byNumber(newNumber)!;
  state.invoices[id]!.status = "PAID";
  state.invoices[id]!.payments.push({ paymentId: "xero-pay-1", amountPence: 12_000, date: "2026-11-08", ours: false });
  writeFileSync(XERO_FILE, JSON.stringify(state));
  await page.goto("/settings/integrations");
  await page.getByRole("button", { name: "Check Xero for payments" }).click();
  await expect(page.getByText("1 invoice marked paid from Xero.")).toBeVisible();
  await page.goto("/invoices?show=paid");
  await expect(page.getByRole("row", { name: new RegExp(newNumber) })).toContainText("Paid");
  // Checking again doesn't record it twice.
  await page.goto("/settings/integrations");
  await page.getByRole("button", { name: "Check Xero for payments" }).click();
  await expect(page.getByText("No new payments in Xero.")).toBeVisible();
});
