import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
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
  await page.getByRole("button", { name: "Save invoice and quote settings" }).click();
  await expect(page.getByText("Invoice and quote settings saved.")).toBeVisible();
  await page.goto("/settings/terms");
  await page.getByLabel("Terms and conditions").fill("Test terms.");
  await page.getByRole("button", { name: "Save terms" }).click();
  await expect(page.getByText(/Terms saved\./)).toBeVisible();
  await page.goto("/settings/invoices");
  await page.getByRole("button", { name: "Connect Stripe" }).click();
  await expect(page.getByText("Connected")).toBeVisible();

  // Self-consumption needs the (synthetic) MCS table and the occupancy.
  await page.goto("/settings/design");
  const sc = page.getByRole("region", { name: "MCS self-consumption table" });
  await sc.getByLabel("CSV file").setInputFiles(path.join(process.cwd(), "e2e", "fixtures", "synthetic-self-consumption.csv"));
  await sc.getByLabel("Source of the values").fill("Synthetic e2e fixture");
  await sc.getByRole("button", { name: "Upload" }).click();
  await expect(sc.getByText(/Version 1/)).toBeVisible();

  await page.goto("/contacts");
  await page.getByRole("link", { name: "Grace Okafor" }).click();
  await page.getByRole("link", { name: /Henleaze/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: /^(\(done\) )?Survey$/ }).click();
  await page.getByLabel("When is someone usually at home?").selectOption("Most of the day");
  await page.getByRole("button", { name: "Save answers" }).click();
  await expect(page.getByText(/answer saved|answers saved/)).toBeVisible();

  // The customer's use and tariff, from their bills.
  await page.goto(`${projectUrl}/design`);
  await page.getByLabel("Annual use (kWh)").fill("4200");
  await page.getByLabel("Unit rate (p/kWh)").fill("24.5");
  await page.getByLabel("Standing charge (p/day)").fill("60");
  await page.getByLabel("Export tariff (p/kWh)").fill("15");
  await page.getByRole("button", { name: "Save energy use and tariff" }).click();
  await expect(page.getByText("Saved, and the design recalculated with these figures.")).toBeVisible();
  await page.reload();
  const firstYear = page.getByTestId("first-year");
  await expect(firstYear.getByText("Bill before")).toBeVisible();
  // 4,200 × 24.5p + 365.25 × 60p = £1,248.15 (months round to the penny).
  await expect(firstYear).toContainText(/£1,248\.1\d/);
  await page.getByRole("link", { name: "Create proposal" }).click();
  await page.waitForURL(/\/proposal$/);
  await page.getByRole("button", { name: "Create proposal from design" }).click();
  await expect(page.getByRole("heading", { name: "Edit draft" })).toBeVisible();
  await expect(page.getByLabel("Line 1 description")).toHaveValue(/all-black panel \(5.34 kWp\)/);
  // Bills, 20-year figures and the cash flow come from the tariff and the price.
  const doc = page.getByRole("article", { name: "Proposal" });
  await expect(doc.getByRole("heading", { name: "Your electricity bills" })).toBeVisible();
  await expect(doc.getByRole("heading", { name: "20-year financial summary" })).toBeVisible();
  await expect(doc.getByTestId("npv")).toHaveText(/£/);
  await expect(doc.getByTestId("payback")).toHaveText(/years|lifetime/);
  await expect(doc.getByTestId("cash-flow").locator("tbody tr")).toHaveCount(21);
  await expect(doc.getByRole("heading", { name: "MCS performance estimate" })).toBeVisible();
  await expect(doc.getByText("Installed capacity of PV system — kWp (STC)")).toBeVisible();

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
  if (process.env.SHOT_DIR) writeFileSync(`${process.env.SHOT_DIR}/proposal.pdf`, await pdf.body());
  // Cover and quote, bills, 20-year figures, and system/MCS pages.
  expect((await pdf.body()).toString("latin1").match(/\/Type\s*\/Page[^s]/g)!.length).toBeGreaterThanOrEqual(4);

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
