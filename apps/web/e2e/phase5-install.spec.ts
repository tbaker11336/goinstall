import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { APP_URL } from "../playwright.config";
import { signInAs } from "./helpers";

// Phase 5 acceptance. Grace Okafor's project has an accepted proposal and a
// paid deposit from phase4-proposal. The office orders kit and books the
// install for Install team A (Dan Hughes); Dan works the job in the
// installer app (web build) in airplane mode, reconnects, and the photo,
// readings and signature appear in the console.

test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1400 } });
const photo = path.join(process.cwd(), "e2e", "fixtures", "site-photo.png");
const todayUk = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

async function openGrace(page: Page, tab: string) {
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Grace Okafor" }).click();
  await page.getByRole("link", { name: /Henleaze/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: tab, exact: true }).click();
}

test("kit ordered, install booked, job completed offline in the app and synced", async ({ page, browser }) => {
  await signInAs(page, "Alex Morgan");

  // Kit: cheapest in stock per line, then one order per supplier.
  await openGrace(page, "Kit & suppliers");
  await expect(page.getByRole("heading", { name: "Kit list" })).toBeVisible();
  await expect(page.getByTestId("kit-line").first()).toBeVisible();
  await page.getByRole("button", { name: /^Place \d+ orders? →$/ }).click();
  const orders = page.getByTestId("purchase-order");
  await expect(orders.first()).toContainText("Sent");
  for (const o of await orders.all()) await o.getByRole("button", { name: "Mark delivered" }).click();
  await expect(orders.first()).toContainText("Delivered");

  // Booking: today, Install team A; then confirm and notify the customer.
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Install & paperwork", exact: true }).click();
  const install = page.getByRole("region", { name: "Install", exact: true });
  await install.getByLabel("Start date").fill(todayUk());
  await install.getByLabel("Working days").fill("1");
  await install.getByLabel("Install team").selectOption({ label: "Install team A · Dan" });
  await install.getByRole("button", { name: "Book install" }).click();
  await expect(install.getByText(/Install booked/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm and notify customer" }).click();
  await expect(page.getByText(/Bookings confirmed\./)).toBeVisible();
  await expect(page.locator("[data-project-page] header").getByText("Scheduled")).toBeVisible();

  // The installer app, signed in as Dan.
  const app = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  await app.goto(APP_URL);
  await app.getByRole("button", { name: /Dan Hughes/ }).click();
  await expect(app.getByText("My jobs")).toBeVisible();
  await expect(app.getByTestId("sync-badge")).toHaveText(/All synced/);
  if (process.env.SHOT_DIR) await app.screenshot({ path: `${process.env.SHOT_DIR}/app-jobs.png` });
  await app.getByTestId("job-card").filter({ hasText: "Henleaze" }).click();
  await expect(app.getByText("Kit check")).toBeVisible();

  // Airplane mode from here.
  await app.context().setOffline(true);
  await app.getByTestId("job-primary").click();
  await expect(app.getByText("Install checklist")).toBeVisible();

  const safety = app.getByTestId("checklist-step").filter({ hasText: "Site safety check" });
  await safety.click();
  const chooser = app.waitForEvent("filechooser");
  await app.getByRole("button", { name: "Add photo for Site safety check and RAMS briefing" }).click();
  await (await chooser).setFiles(photo);
  await expect(app.getByText("1 photo")).toBeVisible();
  await app.getByRole("button", { name: "Mark step done" }).click();

  const tests = app.getByTestId("checklist-step").filter({ hasText: "DC string tests" });
  await tests.click();
  const chooser2 = app.waitForEvent("filechooser");
  await app.getByRole("button", { name: "Add photo for DC string tests" }).click();
  await (await chooser2).setFiles(photo);
  await app.getByLabel("Open-circuit voltage (V)").fill("412");
  await app.getByLabel("Short-circuit current (A)").fill("13.9");
  await app.getByLabel("Insulation resistance (MΩ)").fill("200");
  await app.getByRole("button", { name: "Mark step done" }).click();

  if (process.env.SHOT_DIR) await app.screenshot({ path: `${process.env.SHOT_DIR}/app-checklist.png` });
  await app.getByTestId("to-signoff").click();
  await expect(app.getByText("Customer sign-off")).toBeVisible();
  for (const box of await app.getByRole("checkbox").all()) await box.click();
  const pad = (await app.getByTestId("signature-pad").boundingBox())!;
  await app.mouse.move(pad.x + 40, pad.y + 110);
  await app.mouse.down();
  for (const [dx, dy] of [[80, 40], [120, 90], [160, 50], [220, 100], [280, 60]]) await app.mouse.move(pad.x + dx, pad.y + dy, { steps: 4 });
  await app.mouse.up();
  await app.getByLabel("Printed name").fill("Grace Okafor");
  await app.getByTestId("complete-job").click();
  await expect(app.getByTestId("sync-badge")).toHaveText(/Offline/);

  // Nothing has reached the console yet.
  await page.reload();
  await expect(page.getByText("Nothing recorded yet.")).toBeVisible();

  // Back online: the queue drains.
  await app.context().setOffline(false);
  await app.getByTestId("sync-badge").click();
  await expect(app.getByTestId("sync-badge")).toHaveText(/All synced/, { timeout: 30_000 });

  await page.reload();
  const results = page.getByRole("list", { name: "Checklist results" });
  await expect(results.getByText("DC string tests")).toBeVisible();
  await expect(results.getByText(/Open-circuit voltage: 412 V/)).toBeVisible();
  await expect(results.getByRole("img", { name: "Photo: Site safety check and RAMS briefing" })).toBeVisible();
  await expect(page.getByText(/Signed off by Grace Okafor/)).toBeVisible();
  const signature = page.getByRole("img", { name: "Signature of Grace Okafor" });
  await expect(signature).toBeVisible();
  // The image must actually load, not just be present.
  expect(await signature.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/install-tab.png`, fullPage: true });
});

test("the team calendar feed is private and lists the booking", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/schedule");
  await page.getByRole("button", { name: /calendar link/ }).first().click();
  const url = await page.getByLabel(/calendar link/).first().inputValue();
  const res = await page.request.get(url);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  expect(await res.text()).toContain("Henleaze");
  const forged = await page.request.get(url.replace(/\.[^.]+\.ics$/, ".forged.ics"));
  expect(forged.status()).toBe(404);
});
