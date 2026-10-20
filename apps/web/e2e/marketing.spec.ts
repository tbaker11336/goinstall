import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

test("admin builds the enquiry form, embeds it on a website, and a visitor's enquiry arrives", async ({ page, browser }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/settings/marketing");
  await page.getByLabel("Heading").fill("Free solar quote");
  await page.getByLabel("Address").selectOption("hidden");
  await page.getByRole("checkbox", { name: "Battery" }).uncheck();
  await page.getByRole("button", { name: "Save form" }).click();
  await expect(page.getByText("Form saved.")).toBeVisible();
  const preview = page.frameLocator('iframe[title="Enquiry form preview"]');
  await expect(preview.getByRole("heading", { name: "Free solar quote" })).toBeVisible();
  await expect(preview.getByLabel("Address")).toHaveCount(0);
  const snippet = await page.getByLabel("Embed code").inputValue();

  // A stand-in for the installer's own website, on another origin.
  const site = await (await browser.newContext()).newPage();
  await site.setContent(`<!doctype html><html><body><h1>Brightside Solar</h1>${snippet}</body></html>`);
  const form = site.frameLocator('iframe[title="Enquiry form"]');
  await expect(form.getByRole("heading", { name: "Free solar quote" })).toBeVisible();
  await expect(form.getByRole("checkbox", { name: "Battery" })).toHaveCount(0);
  await form.getByLabel("Your name").fill("Nadia Webb");
  await form.getByLabel("Email").fill("nadia.webb@example.com");
  await form.getByLabel("Phone").fill("07700 900123");
  await form.getByLabel("Postcode").fill("bs6 5aa");
  await form.getByRole("checkbox", { name: "Solar panels" }).check();
  await site.waitForTimeout(2100); // the form ignores instant (bot) submissions
  await form.getByRole("button", { name: "Send enquiry" }).click();
  await expect(form.getByText(/Thanks, we've got your enquiry/)).toBeVisible();

  await page.goto("/contacts?view=list");
  await expect(page.getByRole("link", { name: "Nadia Webb" })).toBeVisible();
});
