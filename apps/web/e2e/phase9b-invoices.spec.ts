import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { OUTBOX } from "../playwright.config";
import { signInAs } from "./helpers";

// Invoices once the quote is accepted. Grace Okafor's quote (phase 4) has its
// deposit and balance paid (phase 6), so it's fully invoiced: extra work is
// invoiced outside it, emailed with a PDF and pay link, paid, and voided.

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 1200 } });

const outbox = () => readFileSync(OUTBOX, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { to: string; subject: string; text: string; attachments?: string[] });

test("invoices on an accepted quote: summary, extra work emailed and paid, a stage can't overrun, void", async ({ page, browser }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Grace Okafor" }).click();
  await page.getByRole("link", { name: /Henleaze/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: /Invoices$/ }).click();

  // The deposit and balance are paid: nothing of the quote is left.
  const list = page.getByRole("list", { name: "Project invoices" });
  await expect(list.getByTestId("invoice-row").filter({ hasText: "Deposit" })).toContainText("Paid");
  await expect(list.getByTestId("invoice-row").filter({ hasText: "Balance" })).toContainText("Paid");
  await expect(page.getByTestId("summary-left-to-invoice")).toHaveText("£0");

  // A stage payment would go over the quote.
  await page.getByLabel("Percentage of the quote").fill("10");
  await expect(page.getByRole("alert").filter({ hasText: "of the quote is left to invoice" })).toBeVisible();

  // Extra work, outside the quote, emailed straight away.
  await page.getByText("Extra work", { exact: true }).click();
  await page.getByLabel("Amount before VAT (£)").fill("250");
  await page.getByLabel("VAT rate (%)").fill("20");
  await expect(page.getByTestId("invoice-preview")).toHaveText("£300");
  await page.getByLabel("Description").fill("Bird mesh around the panels");
  await page.getByRole("button", { name: "Raise invoice" }).click();
  await expect(page.getByText(/Invoice .*-INV-\d+ for £300 raised (and emailed to the customer|\(email recorded)/)).toBeVisible();
  const row = list.getByTestId("invoice-row").filter({ hasText: "Bird mesh around the panels" });
  await expect(row).toContainText("Extra work");
  await expect(row).toContainText("Unpaid");
  const number = (await row.locator("p").first().textContent())!.match(/\S+-INV-\d+/)![0];

  const mail = outbox().reverse().find((e) => e.subject.startsWith(`Invoice ${number} `))!;
  expect(mail.to).toBe("grace.okafor@example.com");
  expect(mail.subject).toMatch(/extra work £300/);
  expect(mail.attachments).toEqual([`${number}.pdf`]);
  // The staff PDF.
  const pdf = await page.request.get((await row.getByRole("link", { name: `PDF of ${number}` }).getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  // Grace's link: what it's for, and the PDF.
  const link = mail.text.match(/https?:\/\/\S+\/i\/[A-Za-z0-9_-]{32}/)![0];
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  await expect(customer.getByRole("heading", { name: "Extra work due" })).toBeVisible();
  await expect(customer.getByText("Bird mesh around the panels")).toBeVisible();
  const own = await customer.request.get(`${new URL(link).pathname}/pdf`);
  expect(own.headers()["content-type"]).toBe("application/pdf");

  // She pays by bank transfer; the office records it.
  await row.getByRole("button", { name: `Record payment: ${number}` }).click();
  await row.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.getByText(/Extra work of £300(\.00)? recorded as paid\./)).toBeVisible();
  await page.reload();
  await expect(list.getByTestId("invoice-row").filter({ hasText: "Bird mesh" })).toContainText("Paid");

  // One raised in error is voided.
  await page.getByText("Extra work", { exact: true }).click();
  await page.getByLabel("Amount before VAT (£)").fill("10");
  await page.getByLabel("VAT rate (%)").fill("0");
  await page.getByLabel("Description").fill("Raised by mistake");
  await page.getByLabel(/Email it to the customer now/).uncheck();
  await page.getByRole("button", { name: "Raise invoice" }).click();
  const wrong = list.getByTestId("invoice-row").filter({ hasText: "Raised by mistake" });
  await expect(wrong).toContainText("not emailed yet");
  page.once("dialog", (d) => d.accept());
  await wrong.getByRole("button", { name: /^Void / }).click();
  await expect(wrong).toContainText("Void");

  // Across projects: the Invoices page.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Invoices" }).click();
  await page.getByLabel("Show").selectOption("paid");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("link", { name: number })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(number) })).toContainText("Grace Okafor");
});
