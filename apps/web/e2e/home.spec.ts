import { expect, test } from "@playwright/test";

test("the homepage is public and links to sign-up", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Run every install, from enquiry to handover, in one place");
  await expect(page.getByRole("link", { name: "Start your free trial" })).toHaveAttribute("href", "/signup");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" }).click();
  await expect(page.getByRole("heading", { name: "Simple pricing per user" })).toBeInViewport();
  // Other pages still need a login.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
