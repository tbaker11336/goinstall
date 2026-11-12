import path from "node:path";
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

// Settings › Proposal template: a front cover with a photo, a reviews page
// and accreditations, shown on draft proposals and drawn in the PDF.

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 1200 } });

test("an admin designs the proposal's cover and pages", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/settings/proposal");
  await page.getByLabel("Headline").fill("Your solar proposal, {first_name}");
  await page.getByLabel("Cover photo", { exact: true }).setInputFiles(path.join(process.cwd(), "e2e", "fixtures", "site-photo.png"));
  await expect(page.getByAltText("Cover photo: chosen image")).toBeVisible();

  // Reviews: switch on, add one.
  await page.getByRole("checkbox", { name: "Show Reviews" }).check();
  await page.getByRole("button", { name: /^Reviews/ }).click();
  await page.getByRole("button", { name: "Add review" }).click();
  await page.getByLabel("Review 1 name").fill("Sarah P.");
  await page.getByLabel("Review 1 location").fill("Bristol");
  await page.getByLabel("Review 1 text").fill("Tidy, quick and explained everything.");
  // Accreditations: switch on, add one, and move it above the quote.
  await page.getByRole("checkbox", { name: "Show Accreditations" }).check();
  await page.getByRole("button", { name: /^Accreditations/ }).click();
  await page.getByRole("button", { name: "Add accreditation" }).click();
  await page.getByLabel("Accreditation 1 name").fill("NICEIC");
  await page.getByLabel("Accreditation 1 number").fill("A123456");
  // A custom page.
  await page.getByRole("button", { name: "Add a custom page" }).click();
  await page.getByRole("textbox", { name: "Heading" }).last().fill("Our guarantee");
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Ten years on our workmanship.");
  await page.getByRole("button", { name: "Save proposal template" }).click();
  await expect(page.getByText(/^Proposal template saved\./)).toBeVisible();

  // Kept after a reload, with the photo.
  await page.reload();
  await expect(page.getByLabel("Headline")).toHaveValue("Your solar proposal, {first_name}");
  await expect(page.getByAltText("Cover photo: chosen image")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Our guarantee/ })).toBeVisible();

  // Rachel Bennett's draft proposal (phase 8) picks it up.
  await page.goto("/contacts?view=list");
  await page.getByRole("link", { name: "Rachel Bennett" }).click();
  await page.getByRole("link", { name: /8 Elm Close/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: /Proposal$/ }).click();
  const doc = page.getByRole("article", { name: "Proposal" });
  await expect(doc.getByTestId("cover-headline")).toHaveText("Your solar proposal, Rachel");
  const reviews = doc.getByTestId("page-reviews");
  await expect(reviews.getByText("Tidy, quick and explained everything.")).toBeVisible();
  await expect(doc.getByTestId("page-accreditations").getByText("A123456")).toBeVisible();
  await expect(doc.getByTestId("page-text").getByText("Ten years on our workmanship.")).toBeVisible();
  // Featured work has nothing in it, so it's left out.
  await expect(doc.getByTestId("page-featured_work")).toHaveCount(0);

  const pdf = await page.request.get((await page.getByRole("link", { name: "Download PDF" }).getAttribute("href"))!);
  expect(pdf.status()).toBe(200);
  const body = await pdf.body();
  if (process.env.SHOT_DIR) writeFileSync(`${process.env.SHOT_DIR}/proposal-template.pdf`, body);

  // The preview in Settings shows the same.
  await page.goto("/settings/proposal/preview");
  await expect(page.getByTestId("cover-headline")).toBeVisible();
  await expect(page.getByTestId("page-reviews")).toBeVisible();
});
