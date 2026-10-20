import path from "node:path";
import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

// Phase 3 acceptance (with SYNTHETIC rule tables from e2e/fixtures): a drawn
// roof is auto-filled with panels and produces an MCS annual figure that
// matches the worked example to the kWh; the EV design sizes its cable.
// Real MCS tables and worked examples come from the business (open question).

test.describe.configure({ timeout: 120_000 });
// Tall enough that the whole plan is on screen for clicks.
test.use({ viewport: { width: 1440, height: 1400 } });
const fixture = (f: string) => path.join(process.cwd(), "e2e", "fixtures", f);

test("design rules upload, solar auto-fill and MCS figure, EV cable sizing", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/settings/design");
  for (const [section, file] of [
    ["MCS kWh/kWp table", "synthetic-mcs-yield.csv"],
    ["MCS postcode zones", "synthetic-mcs-zones.csv"],
    ["Cable table", "synthetic-ev-cables.csv"],
  ] as const) {
    const card = page.getByRole("region", { name: section });
    await card.getByLabel("CSV file").setInputFiles(fixture(file));
    await card.getByLabel("Source of the values").fill("Synthetic e2e fixture");
    await card.getByRole("button", { name: "Upload" }).click();
    await expect(card.getByText(/Version 1/)).toBeVisible();
  }
  await page.getByLabel(/Panel edge setback/).fill("0.4");
  await page.getByLabel(/EV volt drop limit/).fill("5");
  await page.getByLabel(/Charger diversity/).fill("1");
  await page.getByRole("button", { name: "Save design settings" }).click();
  await expect(page.getByText("Design settings saved.")).toBeVisible();

  // Grace Okafor: solar and EV, site postcode BS9.
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Grace Okafor" }).click();
  await page.getByRole("link", { name: /Henleaze/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Design", exact: true }).click();
  await page.waitForURL(/\/design$/);

  await page.getByRole("button", { name: "Draw roof" }).click();
  const plan = page.getByRole("img", { name: /Roof plan/ });
  const box = (await plan.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Pitch 35 sits between the table's 30 and 40: nearest-entry rule picks 30 (first of a tie).
  await page.getByRole("toolbar", { name: "Design tools" }).getByRole("button", { name: "Auto-fill" }).click();
  await expect(page.getByRole("status").filter({ hasText: /12 panels placed/ })).toBeVisible();
  // 12 × 445 W = 5.34 kWp; × 1000 kWh/kWp × shade factor 1 = 5340 kWh.
  await expect(page.getByText("5.34 kWp")).toBeVisible();
  await expect(page.getByText("5,340 kWh")).toBeVisible();
  await expect(page.getByRole("heading", { name: "G99 application needed" })).toBeVisible();
  await expect(page.getByText(/Saved .* ago|Saved just now/)).toBeVisible({ timeout: 20_000 });

  // Saved and recalculated server-side: reload shows the stored design.
  await page.reload();
  await expect(page.getByText("5,340 kWh")).toBeVisible();

  // EV: supply, charger and a route; cable sized from the uploaded table.
  await page.getByRole("link", { name: "EV charger" }).click();
  await page.waitForURL(/view=ev/);
  await page.getByRole("button", { name: "Supply" }).click();
  const site = (await page.getByRole("img", { name: /Site plan/ }).boundingBox())!;
  await page.mouse.click(site.x + site.width * 0.3, site.y + site.height * 0.4);
  await page.mouse.click(site.x + site.width * 0.6, site.y + site.height * 0.6);
  await page.mouse.click(site.x + site.width * 0.3, site.y + site.height * 0.6);
  await page.getByRole("button", { name: "Finish at charger" }).click();
  for (const select of await page.getByRole("combobox", { name: /installed/i }).all()) await select.selectOption("test clipped");
  await page.getByLabel("Main fuse (A)").fill("100");
  await page.getByLabel("Existing max demand (A)").fill("46");
  await expect(page.getByText(/mm² · auto/)).toBeVisible();
  await expect(page.getByText(/within limit/)).toBeVisible();
  await expect(page.getByText("78 A · OK")).toBeVisible();
});
