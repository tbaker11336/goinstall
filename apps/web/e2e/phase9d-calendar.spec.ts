import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { CALENDAR_FILE } from "../playwright.config";
import { signInAs } from "./helpers";

// Google Calendar (the stand-in): an installer connects their calendar and
// gets their upcoming jobs; a booking moved or cancelled in GoInstall follows.

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 1200 } });

type Ev = { summary: string; location: string | null; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string }; bookingId: string; owner: string };
const events = (): Ev[] => {
  try {
    return Object.values(JSON.parse(readFileSync(CALENDAR_FILE, "utf8")) as Record<string, Ev>);
  } catch {
    return [];
  }
};

test("an installer connects Google Calendar; bookings appear, move and disappear", async ({ page }) => {
  // Dan Hughes's team has Owen Lewis's EV install next week (phase 8).
  await signInAs(page, "Dan Hughes");
  await page.goto("/my-calendar");
  await page.getByRole("link", { name: "Connect Google Calendar" }).click();
  await page.waitForURL(/google=connected/);
  await expect(page.getByText("Connected to you@example.com.")).toBeVisible();
  const isJob = (e: Ev) => /^EV charger installation · Owen Lewis/.test(e.summary);
  await expect.poll(() => events().filter(isJob).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const job = events().find(isJob)!;
  expect(job.location).toContain("Gloucester Road");
  expect(job.start.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // The office moves it a day later; Dan's event follows.
  await signInAs(page, "Alex Morgan");
  await page.goto(`/schedule?view=day&date=${job.start.date}`);
  await page.getByRole("button", { name: /EV charger installation Owen Lewis/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "EV charger installation" });
  const next = new Date(Date.parse(`${job.start.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  await dialog.getByLabel(/New date|New first day/).fill(next);
  await dialog.getByRole("button", { name: "Move" }).click();
  await expect(dialog.getByText(/Moved\./)).toBeVisible();
  await expect.poll(() => events().find((e) => e.bookingId === job.bookingId)?.start.date, { timeout: 20_000 }).toBe(next);

  // Cancelled: it comes out of Dan's calendar.
  const projectLink = await dialog.getByRole("link", { name: "Open project" }).getAttribute("href");
  await page.goto(projectLink!);
  await page.getByRole("article", { name: "EV charger installation" }).getByRole("button", { name: "Cancel booking" }).click();
  await expect.poll(() => events().some((e) => e.bookingId === job.bookingId), { timeout: 20_000 }).toBe(false);
});
