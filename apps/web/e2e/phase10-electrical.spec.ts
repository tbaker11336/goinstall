import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

// General electrical work: a project with only "Electrical" ticked has no
// survey or design step; the job is described in words.

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 1200 } });

test("an electrical-only job: described in words, no survey or design step", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/contacts/new");
  await page.getByLabel("First name").fill("Ruth");
  await page.getByLabel("Last name").fill("Ellis");
  await page.getByLabel("Company (optional)").fill("Ellis Lettings Ltd");
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
  // The contact has the name in two parts and the company.
  await page.locator("[data-project-page] header").getByRole("link", { name: "Ruth Ellis" }).click();
  await expect(page.getByRole("heading", { name: "Ruth Ellis", level: 1 })).toBeVisible();
  await expect(page.getByText("Ellis Lettings Ltd").first()).toBeVisible();
  await page.goBack();

  const description = page.getByLabel("Work description", { exact: true });
  await expect(description).toHaveValue("Replace consumer unit; add two double sockets in the kitchen.");
  await description.fill("Replace consumer unit with an RCBO board; add two double sockets in the kitchen.");
  await page.getByRole("button", { name: "Save description" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Work description", { exact: true })).toHaveValue(/RCBO board/);

  // It's a two-hour job: set on the project, it's the booking's starting length.
  await page.getByText("Edit details").click();
  await page.getByLabel("Project length", { exact: true }).fill("2");
  await page.getByLabel("Project length in").selectOption("hours");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("2 hours", { exact: true }).first()).toBeVisible();

  // Booked like any job, with the engineers on it, and named for what it is.
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: /Schedule$/ }).click();
  const install = page.getByRole("region", { name: "New booking" });
  await expect(page.getByRole("region", { name: "Scaffold up" })).toHaveCount(0);
  await expect(install.getByLabel("Length", { exact: true })).toHaveValue("2");
  await expect(install.getByLabel("Length in")).toHaveValue("hours");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  await install.getByLabel("Start date").fill(day);
  await install.getByLabel("Start time").fill("09:00");
  await install.getByLabel("Dan Hughes").check();
  await install.getByLabel("Lee Carter").check();
  await install.getByRole("button", { name: "Book install" }).click();
  await expect(install.getByText("Install booked for 2 hours.")).toBeVisible();
  await page.reload();
  const invite = page.getByRole("article", { name: "Electrical work" });
  await expect(invite).toContainText("Dan Hughes · Engineer");
  await expect(invite).toContainText("Lee Carter · Engineer");
  await expect(invite).toContainText("09:00–11:00");
  // Another visit on the same job, invite-style, with its own title.
  await install.getByText("Other visit", { exact: true }).click();
  await install.getByLabel("Title").fill("Return visit: fit sockets");
  await install.getByLabel("Start date").fill(day);
  await install.getByLabel("Start time").fill("14:00");
  await install.getByLabel("Lee Carter").check();
  await install.getByRole("button", { name: "Book other visit" }).click();
  await expect(install.getByText("Return visit: fit sockets booked for 2 hours.")).toBeVisible();
  await expect(page.getByRole("article", { name: "Return visit: fit sockets" })).toContainText("14:00–16:00");
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/schedule-tab.png`, fullPage: true });

  await page.goto(`/schedule?view=day&date=${day}`);
  const job = page.getByRole("button", { name: /09:00–11:00 Electrical work Ruth Ellis/ });
  await expect(job).toContainText("Dan Hughes, Lee Carter");
  await job.click();
  const dialog = page.getByRole("dialog", { name: "Electrical work" });
  await expect(dialog.getByText("Engineer").first()).toBeVisible();
  await expect(dialog.getByText(/, 09:00–11:00/)).toBeVisible();
});
