import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

// General electrical work: a project with only "Electrical" ticked has no
// survey or design step; the job is described in words.

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 1200 } });

test("an electrical-only job: described in words, no survey or design step", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/contacts/new");
  await page.getByLabel("Name").fill("Ruth Ellis");
  await page.getByLabel("Phone").fill("07700 900188");
  await page.getByLabel("Address", { exact: true }).fill("9 Clifton Down");
  await page.getByLabel("Town").fill("Bristol");
  await page.getByLabel("Postcode").fill("BS8 3HT");
  await page.getByLabel("Electrical").check();
  await page.getByLabel("Work description (optional)").fill("Replace consumer unit; add two double sockets in the kitchen.");
  await page.getByRole("button", { name: "Create enquiry" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);

  const tabs = page.getByRole("navigation", { name: "Project sections" });
  await expect(tabs.getByRole("link", { name: /Proposal$/ })).toBeVisible();
  await expect(tabs.getByRole("link", { name: /Survey$/ })).toHaveCount(0);
  await expect(tabs.getByRole("link", { name: /Design$/ })).toHaveCount(0);
  await expect(page.locator("[data-project-page] header")).toContainText("Electrical");

  const description = page.getByLabel("Work description", { exact: true });
  await expect(description).toHaveValue("Replace consumer unit; add two double sockets in the kitchen.");
  await description.fill("Replace consumer unit with an RCBO board; add two double sockets in the kitchen.");
  await page.getByRole("button", { name: "Save description" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Work description", { exact: true })).toHaveValue(/RCBO board/);

  // Booked like any job, and named for what it is.
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Install & paperwork", exact: true }).click();
  const install = page.getByRole("region", { name: "Install", exact: true });
  await expect(page.getByRole("region", { name: "Scaffold up" })).toHaveCount(0);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  await install.getByLabel("Start date").fill(day);
  await install.getByLabel("Working days").fill("1");
  await install.getByRole("button", { name: "Book install" }).click();
  await expect(install.getByText(/Install booked/)).toBeVisible();
  await page.goto(`/schedule?view=day&date=${day}`);
  await expect(page.getByRole("button", { name: /Electrical work Ruth Ellis/ })).toBeVisible();
});
