import { expect, type Page } from "@playwright/test";

/** Sign in through the dev sign-in page as a seeded user. */
export async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL(/\/(dashboard|no-access)/);
}

export async function expectInColumn(page: Page, column: string, name: string) {
  const col = page.getByRole("region", { name: new RegExp(`^${column}`) });
  await expect(col.getByRole("link", { name })).toBeVisible();
}
