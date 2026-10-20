import { readFileSync } from "node:fs";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { OUTBOX } from "../playwright.config";
import { signInAs } from "./helpers";

// Phase 2 (email and online survey): a customer receives a survey link,
// completes it on a phone, and the answers and photos appear on the Survey
// tab with their sources.

// These walk through several pages, some compiled on first use by the dev server.
test.describe.configure({ timeout: 120_000 });

// A 2×2 PNG, enough for the browser to decode and resize.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNgYGD4z8DAwMDAwMDAAAAZ0gH/2Wu5jwAAAABJRU5ErkJggg==", "base64");

function lastEmailTo(address: string) {
  const lines = readFileSync(OUTBOX, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { to: string; subject: string; text: string });
  const email = lines.filter((e) => e.to === address).at(-1);
  if (!email) throw new Error(`No email to ${address}`);
  return email;
}

async function onPhone(browser: Browser, url: string, fn: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await fn(page);
  } finally {
    await context.close();
  }
}

test("solar and battery: email the survey link, customer completes it on a phone, answers show on the Survey tab", async ({ page, browser }) => {
  await signInAs(page, "Priya Shah");
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Helen Price" }).click();
  await page.getByRole("button", { name: "Send survey link" }).click();
  await expect(page.getByText(/Email recorded/)).toBeVisible();
  // The email is in the thread, and the project has moved to Survey.
  await expect(page.getByText("Your online survey from Brightside Solar & EV Ltd")).toBeVisible();
  await expect(page.getByText("Online survey link sent by email")).toBeVisible();

  const email = lastEmailTo("helen.price@example.com");
  expect(email.text).toContain("Hi Helen,");
  const link = email.text.match(/http:\/\/localhost:\d+\/s\/[A-Za-z0-9_-]{43}/)?.[0];
  expect(link).toBeTruthy();

  await onPhone(browser, link!, async (phone) => {
    await expect(phone.getByRole("heading", { name: "Your solar & battery survey" })).toBeVisible();
    // Solar and battery questions, no EV charger questions.
    await expect(phone.getByText("Where would you like the charger?")).toHaveCount(0);

    // Step 1: energy use.
    await phone.getByLabel("Annual electricity use (kWh)").fill("4,200");
    await phone.getByLabel("Most of the day").check();
    await phone.getByRole("button", { name: "Save and continue" }).click();
    // Step 2: roof.
    await expect(phone.getByRole("heading", { name: /Your roof/ })).toBeFocused();
    await phone.getByLabel("Pitched").check();
    await phone.getByLabel("Concrete tile").check();
    await phone.getByRole("button", { name: "Save and continue" }).click();
    // Step 3: equipment.
    await phone.getByLabel("Where could the inverter and battery go?").fill("Garage, north wall");
    await phone.getByRole("button", { name: "Save and continue" }).click();
    // Step 4: electrics. Earthing is team-only, so it isn't asked.
    await expect(phone.getByText("Earthing arrangement")).toHaveCount(0);
    await phone.getByLabel("Single phase").check();
    await phone.getByLabel("100 A").check();
    await phone.getByRole("button", { name: "Save and continue" }).click();
    // Step 5: photos.
    await expect(phone.getByRole("heading", { name: /Photos/ })).toBeVisible();
    await phone.getByRole("listitem").filter({ hasText: "Meter and main fuse" }).locator('input[type="file"]').setInputFiles({ name: "meter.png", mimeType: "image/png", buffer: PNG });
    await expect(phone.getByRole("img", { name: "Meter and main fuse photo" })).toBeVisible();
    await phone.getByRole("button", { name: "Send to the team" }).click();
    await expect(phone.getByRole("heading", { name: "Thank you, that's everything" })).toBeVisible();
  });

  // Back in the console: the thread shows completion, the Survey tab shows answers with sources.
  await page.reload();
  await expect(page.getByText(/Solar & battery survey completed online · \d+ answers, 1 photo/)).toBeVisible();
  await page.getByRole("link", { name: /14 Cotham Road/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Survey", exact: true }).click();
  await page.waitForURL(/\/survey$/);
  await expect(page.getByText(/Completed/).first()).toBeVisible();
  await expect(page.getByLabel("Annual electricity use (kWh)")).toHaveValue("4200");
  await expect(page.locator("#f_annual_usage_kwh-src")).toHaveText("Online survey");
  await expect(page.getByLabel("Where could the inverter and battery go?")).toHaveValue("Garage, north wall");
  await expect(page.getByRole("img", { name: "Meter and main fuse" })).toBeVisible();
  await expect(page.getByText("Missing").first()).toBeVisible();

  // A staff edit is attributed to the editor; the customer's value is kept in history.
  await page.getByLabel("Earthing arrangement").selectOption("TN-C-S (PME)");
  await page.getByRole("button", { name: "Save answers" }).click();
  await expect(page.getByText("1 answer saved.")).toBeVisible();
  await expect(page.locator("#f_earthing-src")).toHaveText("Edited by Priya Shah");

  // Mark complete warns about missing items, then moves the project to Design.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Mark complete and design/ }).click();
  await expect(page.locator("header").getByText("Design", { exact: true })).toBeVisible();
});

test("EV only: a copied link asks the charger questions and rejects bad answers", async ({ page, browser }) => {
  await signInAs(page, "Priya Shah");
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Tom Aldridge" }).click();
  await page.getByRole("link", { name: /3 Mill Lane/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Survey", exact: true }).click();
  await page.waitForURL(/\/survey$/);
  await page.getByRole("button", { name: "Create link to copy" }).click();
  const link = await page.getByLabel("Survey link").inputValue();
  expect(link).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);

  await onPhone(browser, link, async (phone) => {
    await expect(phone.getByText("Roof covering")).toHaveCount(0);
    // EV-only surveys start with the electrics section (applies to every project).
    await phone.getByLabel("Single phase").check();
    await phone.getByRole("button", { name: "Save and continue" }).click();
    await phone.getByLabel("Where would you like the charger?").fill("Front wall by the drive");
    await phone.getByLabel("Roughly how far is that from your fuse box (metres)?").fill("about ten");
    await phone.getByLabel("Yes").check();
    await phone.getByRole("button", { name: "Save and continue" }).click();
    await expect(phone.getByText(/enter a number/)).toBeVisible();
    await phone.getByLabel("Roughly how far is that from your fuse box (metres)?").fill("12");
    await phone.getByRole("button", { name: "Save and continue" }).click();
    await expect(phone.getByRole("heading", { name: /Photos/ })).toBeVisible();
    await phone.getByRole("button", { name: "Send to the team" }).click();
    await expect(phone.getByRole("heading", { name: "Thank you, that's everything" })).toBeVisible();
  });

  await page.reload();
  await expect(page.getByLabel("Roughly how far is that from your fuse box (metres)?")).toHaveValue("12");

  // A new link replaces the old one.
  await page.getByRole("button", { name: "Create link to copy" }).click();
  await expect(page.getByLabel("Survey link")).not.toHaveValue(link);
  await onPhone(browser, link, async (phone) => {
    await expect(phone.getByRole("heading", { name: "This link isn't working" })).toBeVisible();
  });
});

test("solar and EV: two separate surveys, each with its own link and questions", async ({ page, browser }) => {
  await signInAs(page, "Priya Shah");
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Grace Okafor" }).click();
  await page.getByRole("link", { name: /Henleaze/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Survey", exact: true }).click();
  const surveys = page.getByRole("navigation", { name: "Surveys" });
  await expect(surveys.getByRole("link", { name: "Solar & battery survey" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Create link to copy" }).click();
  const solarLink = await page.getByLabel("Survey link").inputValue();

  await surveys.getByRole("link", { name: "EV charger survey" }).click();
  await page.waitForURL(/kind=ev/);
  await expect(page.getByRole("heading", { name: "Online ev charger survey" })).toBeVisible();
  await page.getByRole("button", { name: "Create link to copy" }).click();
  const evLink = await page.getByLabel("Survey link").inputValue();
  expect(evLink).not.toBe(solarLink);

  await onPhone(browser, evLink, async (phone) => {
    await expect(phone.getByRole("heading", { name: "Your ev charger survey" })).toBeVisible();
    await expect(phone.getByText("Roof covering")).toHaveCount(0);
  });
  // The EV link didn't replace the solar one.
  await onPhone(browser, solarLink, async (phone) => {
    await expect(phone.getByRole("heading", { name: "Your solar & battery survey" })).toBeVisible();
    await expect(phone.getByText("Where would you like the charger?")).toHaveCount(0);
  });
});

test("a made-up survey link shows nothing", async ({ page }) => {
  await page.goto(`/s/${"x".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "This link isn't working" })).toBeVisible();
});
