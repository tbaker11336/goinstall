import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { APP_URL, PUSH_OUTBOX } from "../playwright.config";
import { signInAs } from "./helpers";

// Chat about a job between the office and the installer, and the real roof
// plan in the app. Owen Lewis's EV install is booked for Install team A
// (Dan Hughes) by phase8.

test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 1200 } });

const pushes = () => {
  try {
    return readFileSync(PUSH_OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; title: string; body: string; data: Record<string, string> });
  } catch {
    return [];
  }
};

test("the office and the installer chat about a job", async ({ page, browser, request }) => {
  // Dan's phone registers for push (as the app does after sign-in).
  const users = (await (await request.get("/api/app/dev-login")).json()) as { users: { id: string; full_name: string }[] };
  const dan = users.users.find((u) => u.full_name === "Dan Hughes")!;
  const { token } = (await (await request.post("/api/app/dev-login", { data: { userId: dan.id } })).json()) as { token: string };
  const reg = await request.post("/api/app/push-token", { headers: { Authorization: `Bearer ${token}` }, data: { token: "ExponentPushToken[e2e-dan-phone]", platform: "android" } });
  expect(reg.status()).toBe(200);
  expect((await request.post("/api/app/push-token", { headers: { Authorization: `Bearer ${token}` }, data: { token: "nonsense", platform: "android" } })).status()).toBe(400);

  await signInAs(page, "Alex Morgan");
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Owen Lewis" }).click();
  await page.getByRole("link", { name: /Gloucester Road/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Install & paperwork", exact: true }).click();
  await page.getByLabel("Message to the team").fill("Key safe code is with the neighbour at 54.");
  await page.getByRole("button", { name: "Send to the team" }).click();
  await expect(page.getByText("Sent.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Messages" })).toContainText("Key safe code is with the neighbour at 54.");
  // It reached Dan's phone, and a tap opens the job's chat.
  await expect.poll(() => pushes().find((p) => p.to === "ExponentPushToken[e2e-dan-phone]")).toMatchObject({
    title: "Message from Alex Morgan at 52 Gloucester Road, Bristol",
    body: "Alex Morgan: Key safe code is with the neighbour at 54.",
    data: { event: "team_message" },
  });

  const app = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  await app.goto(APP_URL);
  await app.getByRole("button", { name: /Dan Hughes/ }).click();
  await expect(app.getByText("My jobs")).toBeVisible();
  await app.getByRole("tab", { name: "Messages, 1 unread" }).click();
  await app.getByTestId("chat-thread").filter({ hasText: "52 Gloucester Road" }).click();
  await expect(app.getByText("Key safe code is with the neighbour at 54.")).toBeVisible();
  await app.getByTestId("chat-input").fill("Thanks, I'll grab it on the way.");
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await app.getByRole("link", { name: "Back to Messages" }).click();
  await expect(app.getByTestId("sync-badge")).toHaveText(/All synced/, { timeout: 30_000 });
  // Read now, so no badge.
  await expect(app.getByRole("tab", { name: "Messages", exact: true })).toBeVisible();

  await page.reload();
  const list = page.getByRole("list", { name: "Messages" });
  await expect(list).toContainText("Thanks, I'll grab it on the way.");
  await expect(list).toContainText("Dan Hughes · installer");
});
