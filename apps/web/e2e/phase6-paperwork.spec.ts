import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { OUTBOX } from "../playwright.config";
import { signInAs } from "./helpers";

// Phase 6 acceptance. Grace Okafor's install was completed in the app by
// phase5-install. Completing it produced the paperwork items (G99, MCS, EIC,
// warranties, handover pack) with fields pre-filled,
// moved the project to Complete and emailed the balance invoice.

test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1400 } });
const certificate = path.join(process.cwd(), "e2e", "fixtures", "test-certificate.pdf");

async function openGrace(page: Page, tab: RegExp) {
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Grace Okafor" }).click();
  await page.getByRole("link", { name: /Henleaze/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: tab }).click();
}

const outbox = () => readFileSync(OUTBOX, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { to: string; subject: string; text: string; attachments?: string[] });

test("completing a job produces the correct paperwork items with fields pre-filled", async ({ page, browser }) => {
  await signInAs(page, "Alex Morgan");
  await openGrace(page, /Install & paperwork$/);
  await expect(page.locator("[data-project-page] header").getByText("Complete")).toBeVisible();

  // Solar with G99 from the design (her EV design was never saved, so no EV notification yet).
  const items = page.getByRole("list", { name: "Paperwork items" });
  for (const title of ["G99 application to the DNO", "MCS certificate", "Electrical installation certificate", "Customer handover pack"]) {
    await expect(items.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  }
  await expect(items.getByRole("link", { name: /Warranty registration: 445 W all-black panel/ })).toBeVisible();
  await expect(items.getByRole("link", { name: /Warranty registration: 5 kW hybrid inverter/ })).toBeVisible();
  await expect(items.getByRole("link", { name: /G98 notification|EV charger notification/ })).toHaveCount(0);

  // The EIC sheet carries the readings from the app.
  await items.getByRole("link", { name: /Electrical installation certificate/ }).click();
  const values = page.getByRole("list", { name: "Pre-filled values" }).or(page.locator("dl[aria-label='Pre-filled values']"));
  await expect(values.getByText("DC string tests: Open-circuit voltage")).toBeVisible();
  await expect(values.getByText("412 V")).toBeVisible();
  await expect(values.getByText("Brightside Solar & EV Ltd").first()).toBeVisible();
  // Upload the signed certificate from the electrician's software.
  await page.getByLabel("Attach a document").setInputFiles(certificate);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("test-certificate.pdf attached.")).toBeVisible();
  await page.getByRole("button", { name: "Make details sheet (PDF)" }).click();
  await expect(page.getByText(/details sheet made/)).toBeVisible();
  await expect(page.getByText("Made by GoInstall")).toBeVisible();

  // G99: the MPAN, then submitted with the DNO's reference.
  await page.getByRole("main").getByRole("link", { name: "Install & paperwork", exact: true }).click();
  await page.getByRole("list", { name: "Paperwork items" }).getByRole("link", { name: /G99 application/ }).click();
  await expect(page.locator("dl[aria-label='Pre-filled values']").getByText("Registered capacity")).toBeVisible();
  await expect(page.locator("dl[aria-label='Pre-filled values']").getByText("5 kW AC")).toBeVisible();
  await page.getByLabel("MPAN (13-digit core)").fill("12 0002 3305 967");
  await page.getByRole("button", { name: "Save MPAN" }).click();
  await expect(page.getByText("MPAN saved.")).toBeVisible();
  await expect(page.locator("dl[aria-label='Pre-filled values']").getByText("1200023305967")).toBeVisible();
  await page.getByLabel("Status", { exact: true }).selectOption("submitted");
  await page.getByLabel("DNO reference").fill("WPD-G99-4471");
  await page.getByLabel("Portal link", { exact: true }).fill("https://dno.example/applications/4471");
  await page.getByLabel("Location of the lockable isolation switch").fill("Beside the meter in the garage");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("DNO reference")).toHaveValue("WPD-G99-4471");
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/paperwork-item.png`, fullPage: true });
  await expect(page.locator("dl[aria-label='Pre-filled values']").getByText("Location of the lockable isolation switch")).toHaveCount(0);

  // Generate forms: a details sheet for every open item.
  await page.getByRole("main").getByRole("link", { name: "Install & paperwork", exact: true }).click();
  await expect(page.getByText(/\d of \d+ started/)).toBeVisible();
  await page.getByRole("button", { name: "Generate forms" }).click();
  await expect(page.getByText(/\d+ details sheets made\./)).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/paperwork-install.png`, fullPage: true });

  // The balance invoice went to Grace with a pay link; she pays by card.
  const invoiceEmail = outbox().reverse().find((e) => /^Invoice .*balance/.test(e.subject))!;
  expect(invoiceEmail.to).toBe("grace.okafor@example.com");
  const link = invoiceEmail.text.match(/https?:\/\/\S+\/i\/[A-Za-z0-9_-]{32}/)![0];
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(link);
  await expect(customer.getByRole("heading", { name: "Balance due" })).toBeVisible();
  await customer.getByRole("button", { name: /by card/ }).click();
  await customer.getByRole("button", { name: /^Pay £/ }).click();
  await expect(customer.getByText(/Paid on .*Thank you\./)).toBeVisible();
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: /Proposal$/ }).click();
  const balance = page.getByRole("complementary", { name: "Proposal status" });
  await expect(balance.getByText(/^Paid /)).toBeVisible();

  // Handover pack: design, SLD and the uploaded EIC, emailed to the customer.
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: /Install & paperwork$/ }).click();
  await page.getByRole("list", { name: "Paperwork items" }).getByRole("link", { name: /Customer handover pack/ }).click();
  await page.getByRole("button", { name: "Email pack to the customer" }).click();
  await expect(page.getByText(/Handover pack sent\..*Not included yet: MCS certificate\./)).toBeVisible({ timeout: 30_000 });
  const pack = outbox().reverse().find((e) => /handover pack/i.test(e.subject))!;
  expect(pack.to).toBe("grace.okafor@example.com");
  expect(pack.attachments).toEqual(["handover-pack.pdf"]);
  await page.getByRole("main").getByRole("link", { name: "Install & paperwork", exact: true }).click();
  await expect(page.getByRole("list", { name: "Paperwork items" }).getByRole("link", { name: /Customer handover pack.*Done/ })).toBeVisible();
});
