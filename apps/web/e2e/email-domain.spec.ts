import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { OUTBOX } from "../playwright.config";
import { signInAs } from "./helpers";

// Sending domains use the stand-in provider here (no RESEND_API_KEY): DNS
// records look real and the domain verifies on the first check.

test("admin connects the company's own domain; emails then go from it", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Set up email sending" }).click();
  await expect(page.getByText(/Emails currently go from .*Brightside Solar & EV Ltd/)).toBeVisible();
  await page.getByLabel("Your domain").fill("https://www.brightside-solar.example/");
  await page.getByLabel("Send from").fill("hello");
  await page.getByRole("button", { name: "Connect domain" }).click();
  await expect(page.getByText("Domain added.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "DNS records for brightside-solar.example" })).toBeVisible();
  await expect(page.getByTestId("dns-record")).toHaveCount(3);
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText("Verified. Emails now go from hello@brightside-solar.example.")).toBeVisible();

  // A survey email now comes from the company's own address.
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Rachel Bennett" }).click();
  await page.getByRole("button", { name: "Send survey link" }).click();
  await expect(page.getByText(/sent\./).first()).toBeVisible();
  const emails = readFileSync(OUTBOX, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { from: string; subject: string });
  expect(emails.at(-1)!.from).toBe('"Brightside Solar & EV Ltd" <hello@brightside-solar.example>');

  // Removing it goes back to the GoInstall address.
  await page.goto("/settings/email");
  await page.getByRole("button", { name: "Remove domain" }).click();
  await expect(page.getByText("Not connected")).toBeVisible();
  await expect(page.getByText(/Emails currently go from .*no-reply@localhost|Emails currently go from .*@/)).toBeVisible();
});
