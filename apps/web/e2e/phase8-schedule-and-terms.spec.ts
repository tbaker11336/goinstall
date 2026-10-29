import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { APP_URL, OUTBOX } from "../playwright.config";
import { signInAs } from "./helpers";

// The October change batch: an EV-only install has no scaffold bookings;
// the installer declines it in the app; the office sees that on the new
// calendar, reschedules it and tells the customer. Then the company's terms
// PDF goes onto a new proposal. Runs after the earlier phases' data.

test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1200 } });
const todayUk = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lines = <T,>(file: string) => {
  try {
    return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
  } catch {
    return [] as T[];
  }
};

test("EV install: no scaffold, declined in the app, rescheduled and the customer told from the calendar", async ({ page, browser }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Owen Lewis" }).click();
  await page.getByRole("link", { name: /Gloucester Road/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Install & paperwork", exact: true }).click();
  const install = page.getByRole("region", { name: "Install", exact: true });
  await expect(install).toBeVisible();
  // Scaffold is for solar roofs only.
  await expect(page.getByRole("region", { name: "Scaffold up" })).toHaveCount(0);
  await install.getByLabel("Start date").fill(todayUk());
  await install.getByLabel("Working days").fill("1");
  await install.getByLabel("Install team").selectOption({ label: "Install team A · Dan" });
  await install.getByRole("button", { name: "Book install" }).click();
  await expect(install.getByText(/Install booked/)).toBeVisible();

  // Dan can't make it and says so in the app.
  const app = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  await app.goto(APP_URL);
  await app.getByRole("button", { name: /Dan Hughes/ }).click();
  await expect(app.getByText("My jobs")).toBeVisible();
  const card = app.getByTestId("job-card").filter({ hasText: "Gloucester Road" }).first();
  await expect(card).toHaveAccessibleName(/needs your answer/);
  await card.click();
  await expect(app.getByText("Can you do this job?")).toBeVisible();
  await app.getByRole("button", { name: "Decline" }).click();
  await app.getByTestId("decline-reason").fill("Van in for repair");
  await app.getByRole("button", { name: "Send decline" }).click();
  await expect(app.getByTestId("job-answer")).toContainText("You declined: Van in for repair");
  await app.getByRole("link", { name: "Back to My jobs" }).click();
  await expect(app.getByTestId("sync-badge")).toHaveText(/All synced/, { timeout: 30_000 });

  // The office sees it on the calendar.
  await page.goto(`/schedule?view=day&date=${todayUk()}`);
  await expect(page.getByRole("heading", { name: /\d{4}$/, level: 2 }).first()).toBeVisible();
  const event = page.getByRole("button", { name: /^All day EV charger installation Owen Lewis/ });
  await event.click();
  const dialog = page.getByRole("dialog", { name: "EV charger installation" });
  await expect(dialog.getByText("Dan Hughes: declined (Van in for repair)")).toBeVisible();

  // Move it a week on (that asks Dan again), then tell Owen.
  const next = addDays(todayUk(), 7);
  await dialog.getByLabel(/New date|New first day/).fill(next);
  await dialog.getByRole("button", { name: "Move" }).click();
  await expect(dialog.getByText(/Moved\./)).toBeVisible();
  await dialog.getByRole("button", { name: "Notify customer" }).click();
  await expect(dialog.getByText(/Owen Lewis (emailed|email recorded)/)).toBeVisible();
  // Moving it asked Dan again.
  await expect(dialog.getByText("Waiting for them to accept in the app")).toBeVisible();
  const mail = lines<{ to: string; subject: string; text: string }>(OUTBOX).reverse().find((e) => e.to === "owen.lewis@example.com");
  expect(mail?.subject).toMatch(/^EV charger installation: /);
  expect(mail?.text).toContain("52 Gloucester Road");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Week and month views, and the team filter.
  await page.goto(`/schedule?view=week&date=${next}`);
  await expect(page.getByRole("heading", { name: /^Week of / })).toBeVisible();
  await expect(page.getByRole("button", { name: /^EV charger installation Owen Lewis/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "month" }).click();
  await page.waitForURL(/view=month/);
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByLabel("Team").selectOption({ label: "Install team A" });
  await page.waitForURL(/team=/);
  // Month cells show just the title.
  await expect(page.getByRole("button", { name: /^(✕ Declined: )?EV charger installation$/ }).first()).toBeVisible();

  // The moved job asks Dan again (in the app, the next day it's on).
  await app.reload();
  await expect(app.getByText("My jobs")).toBeVisible();
});

test("terms and conditions PDF goes onto new proposals", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/settings/terms");
  await page.getByLabel("Upload a PDF").setInputFiles(path.join(process.cwd(), "e2e", "fixtures", "test-certificate.pdf"));
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("test-certificate.pdf attached to your proposals.")).toBeVisible();
  await page.getByLabel("Terms and conditions").fill("Balance due on completion.");
  await page.getByRole("button", { name: "Save terms" }).click();
  await expect(page.getByText(/Terms saved\./)).toBeVisible();

  await page.goto("/contacts");
  await page.getByRole("link", { name: "Rachel Bennett" }).click();
  await page.getByRole("link", { name: /8 Elm Close/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: /Proposal$/ }).click();
  await page.getByRole("button", { name: "Create proposal from design" }).click();
  const doc = page.getByRole("article", { name: "Proposal" });
  await expect(doc.getByRole("heading", { name: "Terms and conditions" })).toBeVisible();
  await expect(doc.getByRole("link", { name: /Read the terms and conditions \(PDF\)/ })).toBeVisible();
});
