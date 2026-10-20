import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { OUTBOX } from "../playwright.config";
import { signInAs } from "./helpers";

// Phase 4 acceptance: from the saved design (phase3-design runs first and
// designs Grace Okafor's solar + EV) to a sent proposal, customer accept and
// sign, and a card deposit through the fake Stripe Checkout (PAYMENTS_FAKE).
// VAT rates here are test values: the business sets the real ones.

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 1400 } });

test("design → proposal → send → accept and sign → deposit paid", async ({ page, browser }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/settings/invoices");
  for (const cat of ["Panel", "Inverter", "Battery", "Mounting", "Labour"]) await page.getByLabel(`${cat} (%)`).fill("0");
  await page.getByLabel("EV charger (%)").fill("20");
  await page.getByLabel("Days a proposal is valid").fill("30");
  await page.getByLabel("Deposit (% of total)").fill("25");
  await page.getByLabel("Single-visit discount (£)").fill("150");
  await page.getByLabel("Account name").fill("Brightside Solar Ltd");
  await page.getByLabel("Sort code").fill("12-34-56");
  await page.getByLabel("Account number").fill("12345678");
  await page.getByLabel("Terms and conditions").fill("Test terms.");
  await page.getByRole("button", { name: "Save invoice and quote settings" }).click();
  await expect(page.getByText("Invoice and quote settings saved.")).toBeVisible();
  await page.getByRole("button", { name: "Connect Stripe" }).click();
  await expect(page.getByText("Connected")).toBeVisible();

  await page.goto("/contacts");
  await page.getByRole("link", { name: "Grace Okafor" }).click();
  await page.getByRole("link", { name: /Henleaze/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Design", exact: true }).click();
  await page.getByRole("link", { name: "Create proposal" }).click();
  await page.waitForURL(/\/proposal$/);
  await page.getByRole("button", { name: "Create proposal from design" }).click();
  await expect(page.getByRole("heading", { name: "Edit draft" })).toBeVisible();
  await expect(page.getByLabel("Line 1 description")).toHaveValue(/all-black panel \(5.34 kWp\)/);

  await page.getByRole("button", { name: "Add line" }).click();
  const n = await page.getByTestId("proposal-line").count();
  await page.getByLabel(`Line ${n} description`).fill("Scaffolding");
  await page.getByLabel(`Line ${n} unit price`).fill("650");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/^Saved\. Total/)).toBeVisible();
  await expect(page.getByRole("article", { name: "Proposal" }).getByText("Scaffolding")).toBeVisible();

  await page.getByRole("button", { name: "Send proposal" }).click();
  await expect(page.getByText(/Proposal sent\./)).toBeVisible();
  await expect(page.getByText("Sent by email")).toBeVisible();
  const pdf = await page.request.get(await page.getByRole("link", { name: "Download PDF" }).getAttribute("href").then((h) => h!));
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  const email = readFileSync(OUTBOX, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { to: string; subject: string; text: string }).reverse().find((e) => /proposal/i.test(e.subject))!;
  const link = email.text.match(/https?:\/\/\S+\/p\/[A-Za-z0-9_-]{43}/)![0];

  // The customer, signed out.
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  await expect(customer.getByRole("heading", { name: "Your proposal" })).toBeVisible();
  const total = await customer.getByTestId("proposal-total").textContent();
  await customer.getByLabel("Your full name").fill("Grace Okafor");
  await customer.getByRole("checkbox").check();
  await customer.getByRole("button", { name: "Accept and sign" }).click();
  await expect(customer.getByRole("heading", { name: "Pay your deposit" })).toBeVisible();
  await expect(customer.getByText("Sort code")).toBeVisible();
  await customer.getByRole("button", { name: /by card/ }).click();
  await customer.getByRole("button", { name: /^Pay £/ }).click();
  await expect(customer.getByRole("heading", { name: "All confirmed" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Signed by Grace Okafor")).toBeVisible();
  await expect(page.getByText(/-INV-0001/)).toBeVisible();
  await expect(page.getByTestId("proposal-total")).toHaveText(total!);
  await expect(page.locator("header").getByText("Deposit paid")).toBeVisible();
  if (process.env.SHOT_DIR) { await page.screenshot({ path: `${process.env.SHOT_DIR}/proposal-tab.png`, fullPage: true }); await customer.screenshot({ path: `${process.env.SHOT_DIR}/proposal-public.png`, fullPage: true }); }
});

test("a broken proposal link explains itself", async ({ page }) => {
  await page.goto(`/p/${"x".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "This link isn't working" })).toBeVisible();
});
