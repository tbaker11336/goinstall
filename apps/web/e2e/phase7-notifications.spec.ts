import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { CRON_SECRET, OUTBOX, SMS_OUTBOX } from "../playwright.config";
import { signInAs } from "./helpers";

// Notifications: in-app for the team, customer reminders by email from the
// daily job, and the SMS add-on (subscribe, number attached by GoInstall,
// texts out and replies in). Twilio and Stripe are recorded stand-ins here.

test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1200 } });

const lines = <T,>(file: string) => {
  try {
    return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
  } catch {
    return [] as T[];
  }
};

async function openOwen(page: Page) {
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Owen Lewis" }).click();
  await page.waitForURL(/\/contacts\/[0-9a-f-]{36}$/);
}

test("team notifications in the app, and survey reminders from the daily job", async ({ page, request }) => {
  await signInAs(page, "Alex Morgan");

  // Reminders are off until the company sets them.
  await page.goto("/settings/notifications");
  await expect(page.getByLabel("Online survey: days after sending")).toHaveValue("");
  await page.getByLabel("Online survey: days after sending").fill("0");
  await page.getByLabel("New enquiry: Email").uncheck();
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByText("Notification settings saved.")).toBeVisible();

  // An enquiry Alex adds for Priya: she's told in the app (email switched off above).
  const before = lines(OUTBOX).length;
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "New enquiry" }).first().click();
  await page.getByLabel("Name").fill("Nina Okoro");
  await page.getByLabel("Phone").fill("07700 900199");
  await page.getByLabel("Address", { exact: true }).fill("4 Harbour View");
  await page.getByLabel("Town").fill("Portishead");
  await page.getByLabel("Postcode").fill("BS20 7AA");
  await page.getByLabel("Owner").selectOption({ label: "Priya Shah" });
  await page.getByLabel("Solar").check();
  await page.getByRole("button", { name: "Create enquiry" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  expect(lines<{ subject: string }>(OUTBOX).slice(before).some((e) => /New enquiry/.test(e.subject))).toBe(false);

  await signInAs(page, "Priya Shah");
  const bell = page.getByRole("navigation", { name: "Main" }).locator("..").getByRole("link", { name: /Notifications/ });
  await expect(bell).toContainText(/\d+ unread/);
  await bell.click();
  const enquiry = page.getByRole("link", { name: /New enquiry at 4 Harbour View, Portishead/ });
  await expect(enquiry).toContainText("Nina Okoro, added by a colleague.");
  await expect(enquiry).toContainText("(unread)");
  await enquiry.click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.goto("/notifications");
  await expect(enquiry).not.toContainText("(unread)");

  // Survey link to Owen, then the daily job sends the reminder (once).
  await openOwen(page);
  await page.getByRole("button", { name: "Send survey link" }).click();
  await expect.poll(() => lines<{ to: string }>(OUTBOX).some((e) => e.to === "owen.lewis@example.com")).toBe(true);
  const original = lines<{ to: string; subject: string; text: string }>(OUTBOX).reverse().find((e) => e.to === "owen.lewis@example.com")!;
  const originalLink = original.text.match(/https?:\/\/\S+\/s\/[A-Za-z0-9_-]{43}/)![0];

  const unauthorised = await request.get("/api/cron/reminders");
  expect(unauthorised.status()).toBe(401);
  const run = await request.get("/api/cron/reminders", { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  expect(run.status()).toBe(200);
  expect((await run.json()).sent).toBeGreaterThanOrEqual(1);
  const reminder = lines<{ to: string; subject: string; text: string }>(OUTBOX).reverse().find((e) => e.to === "owen.lewis@example.com" && /reminder/i.test(e.subject))!;
  expect(reminder.text).toContain(originalLink); // the same link still works
  const again = await request.get("/api/cron/reminders", { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  expect((await again.json()).sent).toBe(0);
  await page.goto(originalLink);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/isn't working|expired/i)).toHaveCount(0);
});

test("SMS add-on: subscribe, GoInstall attaches the number, texts out and replies in", async ({ page, request }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/settings/sms");
  await expect(page.getByText("£15", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Add SMS for £15 a month" }).click();
  await page.getByRole("button", { name: "Subscribe" }).click();
  await page.waitForURL(/\/settings\/sms\?subscribed=1/);
  await expect(page.getByText("Setting up your number")).toBeVisible();
  await page.getByLabel("Company number").fill("12345678");
  await page.getByRole("button", { name: "Send details" }).click();
  await expect(page.getByText(/Details saved/)).toBeVisible();

  // GoInstall staff attach the number once Twilio approves the business.
  await page.goto("/platform/sms");
  // One company on the add-on in this test database.
  const card = page.getByRole("main");
  await expect(card.getByText("12345678")).toBeVisible();
  await card.getByRole("button", { name: "Find numbers" }).click();
  await card.getByRole("button", { name: "Buy and attach" }).click();
  await expect(page.getByText(/Number \+447700900001 since/)).toBeVisible();

  await page.goto("/settings/sms");
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("07700 900001")).toBeVisible();
  await expect(page.getByText(/0 of 200 texts/)).toBeVisible();

  // A text to Owen from the contact page.
  await openOwen(page);
  await page.getByLabel("Send via").selectOption("sms");
  await page.getByLabel("Text message").fill("Hi Owen, are you free for a quick call about your charger?");
  await page.getByRole("button", { name: "Send text" }).click();
  await expect(page.getByText("Text sent.")).toBeVisible();
  const text = lines<{ to: string; from: string; body: string }>(SMS_OUTBOX).at(-1)!;
  expect(text).toMatchObject({ to: "+447700900106", from: "+447700900001" });

  // Owen replies STOP: it lands in his thread and he's opted out of texts.
  const reply = await request.post("/api/webhooks/twilio/sms", { form: { From: "+447700900106", To: "+447700900001", Body: "STOP", MessageSid: "SMe2e1" } });
  expect(reply.status()).toBe(200);
  await page.reload();
  await expect(page.getByLabel("Conversation").getByText("STOP", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Send via").locator("option[value=sms]")).toHaveText("SMS (opted out)");
  await page.goto("/settings/sms");
  await expect(page.getByText(/1 of 200 texts/)).toBeVisible();
});
