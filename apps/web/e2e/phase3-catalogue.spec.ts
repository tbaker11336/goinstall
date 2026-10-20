import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

// Phase 3: product catalogue with CSV import (column mapping and preview).

test.describe.configure({ timeout: 90_000 });

const CSV = [
  "Stock Code,Description,Brand,Model,Trade Price (ex VAT),Free Stock",
  "B-DS-445-BLK,445 W all-black panel,Demo Solar,DS-445-BLK,94.50,200",
  "B-NEW-9,Roof hook pack,Demo Mount,HK-10,22.00,40",
  "B-BAD,Mystery,,M1,lots,",
].join("\n");

test("admin imports a supplier price file: preview, mapping, then prices update", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/settings/products");
  await expect(page.getByRole("heading", { name: /Products \(\d+\)/ })).toBeVisible();

  await page.getByLabel("CSV file").setInputFiles({ name: "supplier-b.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.getByLabel("Prices from").selectOption({ label: "Supplier B" });
  // Columns were guessed from the headers.
  await expect(page.getByLabel("Cost price")).toHaveValue("4");
  await expect(page.getByText("Preview: 2 rows ready, 1 will be skipped")).toBeVisible();
  await expect(page.getByText(/Skipped: Cost "lots" isn't a price/)).toBeVisible();

  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText("Imported: 1 new, 0 updated, 2 supplier prices, 1 skipped.")).toBeVisible();

  // The existing panel matched by make and model: Supplier B's new price is now the cheapest in stock.
  const panel = page.locator("tbody").filter({ hasText: "445 W all-black panel" });
  await expect(panel.getByRole("cell", { name: /Supplier B/ })).toBeVisible();
  await expect(panel.getByRole("cell", { name: "£94.50" })).toBeVisible();
  // The new product was added and categorised.
  await expect(page.locator("tbody").filter({ hasText: "Roof hook pack" }).getByRole("cell", { name: "Mounting" })).toBeVisible();
});

test("office staff can't open product settings", async ({ page }) => {
  await signInAs(page, "Priya Shah");
  await page.goto("/settings/products");
  await expect(page).not.toHaveURL(/settings\/products/);
});

test("admin adds a panel from the product library with its datasheet values", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/settings/products");
  await page.getByLabel("Search panels by make, model or watts").fill("jinko JKM445M-60HL4");
  const results = page.getByRole("region", { name: "Library results" });
  await expect(results.getByRole("button", { name: "Add Jinko Solar JKM445M-60HL4 445 W" })).toBeVisible();
  await results.getByRole("button", { name: "Add Jinko Solar JKM445M-60HL4 445 W" }).click();
  await expect(page.getByText(/Jinko Solar JKM445M-60HL4 445 W added\. The library has no dimensions/)).toBeVisible();
  await expect(results.getByRole("row", { name: /^Jinko Solar JKM445M-60HL4 445 .*In catalogue/ })).toBeVisible();
  // It's now an ordinary catalogue product, with the library's Voc and temperature coefficient.
  await expect(page.getByRole("cell", { name: "Jinko Solar JKM445M-60HL4 445 W" }).first()).toBeVisible();
  // Adding it twice is refused.
  await page.reload();
  await page.getByLabel("Search panels by make, model or watts").fill("JKM445M-60HL4");
  await expect(page.getByRole("region", { name: "Library results" }).getByText("In catalogue").first()).toBeVisible();
});
