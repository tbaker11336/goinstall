import { expect, test } from "@playwright/test";
import { expectInColumn, signInAs } from "./helpers";

// Phase 1 acceptance: a new enquiry can be created, moved across Kanban
// stages and opened as a project; users of one company cannot see another's.

test("create an enquiry, move it across the Kanban and open the project", async ({ page }) => {
  await signInAs(page, "Priya Shah");
  await page.getByRole("link", { name: "New enquiry" }).first().click();

  await page.getByLabel("Name").fill("Nina Patel");
  await page.getByLabel("Phone").fill("07700 900555");
  await page.getByLabel("Email").fill("nina.patel@example.com");
  await page.getByLabel("Address", { exact: true }).fill("41 Redland Grove");
  await page.getByLabel("Town").fill("Bristol");
  await page.getByLabel("Postcode").fill("bs6 6ph");
  await page.getByLabel("Source").selectOption("Referral");
  await page.getByLabel("Solar").check();
  await page.getByLabel("EV charger").check();
  await page.getByLabel("Notes (optional)").fill("Has a Tesla, wants solar to charge it.");
  await page.getByRole("button", { name: "Create enquiry" }).click();

  // Lands on the new project.
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("41 Redland Grove, Bristol");
  await expect(page.getByText("Has a Tesla, wants solar to charge it.")).toBeVisible();
  await expect(page.getByText("Project created")).toBeVisible();
  const projectUrl = page.url();

  // Kanban: starts in New enquiry; drag to Survey.
  await page.getByRole("link", { name: "Contacts" }).click();
  await expectInColumn(page, "New enquiry", "Nina Patel");
  const card = page.getByTestId("kanban-card").filter({ hasText: "Nina Patel" });
  await card.dragTo(page.getByRole("region", { name: /^Survey/ }));
  await expectInColumn(page, "Survey", "Nina Patel");

  // Keyboard-accessible move to Design.
  await card.getByLabel("Move Nina Patel to").selectOption("design");
  await expectInColumn(page, "Design", "Nina Patel");

  // The move survives a reload and moved the project too.
  await page.reload();
  await expectInColumn(page, "Design", "Nina Patel");
  await page.goto(projectUrl);
  await expect(page.getByText("Stage changed from Survey to Design")).toBeVisible();

  // Lost needs a reason.
  await page.goto("/contacts");
  await card.getByLabel("Move Nina Patel to").selectOption("lost");
  const dialog = page.getByRole("dialog", { name: "Mark Nina Patel as lost" });
  await dialog.getByLabel("Reason").fill("Decided to wait a year");
  await dialog.getByRole("button", { name: "Mark lost" }).click();
  await expectInColumn(page, "Lost", "Nina Patel");

  // Open the contact, then the project from it.
  await page.getByRole("link", { name: "Nina Patel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nina Patel" })).toBeVisible();
  await page.getByRole("link", { name: /41 Redland Grove/ }).click();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.getByText("Reason: Decided to wait a year")).toBeVisible();
  await page.getByRole("button", { name: "Reopen at Design" }).click();
  await expect(page.getByRole("button", { name: "Move to Proposal sent" })).toBeVisible();
});

test("list view is remembered and filters work", async ({ page }) => {
  await signInAs(page, "Priya Shah");
  await page.goto("/contacts");
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("columnheader", { name: "Last activity" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("columnheader", { name: "Last activity" })).toBeVisible();

  await page.getByLabel("Product").selectOption("ev");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("link", { name: "Tom Aldridge" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Helen Price" })).toHaveCount(0);

  await page.getByRole("link", { name: "Clear" }).click();
  await page.getByLabel("Search").fill("900103");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("link", { name: "Grace Okafor" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tom Aldridge" })).toHaveCount(0);

  await page.getByRole("button", { name: "Kanban" }).click();
});

test("notes appear in the contact thread", async ({ page }) => {
  await signInAs(page, "Priya Shah");
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Helen Price" }).click();
  await page.getByLabel("Send via").selectOption("note");
  await page.getByLabel("Note").fill("Left a voicemail about the survey.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Left a voicemail about the survey.")).toBeVisible();
  await page.getByRole("link", { name: "Notes" }).click();
  await expect(page.getByText("Left a voicemail about the survey.")).toBeVisible();
  await expect(page.getByText("Project created")).toHaveCount(0);
});

test("one company cannot see another company's data", async ({ page }) => {
  // Find a Brightside project URL first.
  await signInAs(page, "Priya Shah");
  await page.goto("/projects");
  await page.getByRole("link", { name: /Cotham Road/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const brightsideProject = page.url();

  await signInAs(page, "Sam Wright");
  await expect(page.getByText("Northern Renewables")).toBeVisible();
  await page.goto("/contacts?view=list");
  await expect(page.getByRole("link", { name: "Isla Moore" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Helen Price" })).toHaveCount(0);

  // Next.js streams pages, so a not-found from a nested layout can arrive
  // with status 200; what matters is that none of the project is shown.
  await page.goto(brightsideProject);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByText("Cotham Road")).toHaveCount(0);
  await expect(page.getByText("Helen Price")).toHaveCount(0);
});

test("installers are sent to the app, office staff can't open settings", async ({ page }) => {
  await signInAs(page, "Dan Hughes");
  await expect(page).toHaveURL(/\/no-access$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/no-access$/);

  await signInAs(page, "Priya Shah");
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/settings/company");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("admin edits company details and invites a colleague", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("MCS certification number").fill("NAP-99999");
  await page.getByRole("button", { name: "Save company details" }).click();
  await expect(page.getByText("Company details saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("MCS certification number")).toHaveValue("NAP-99999");

  await page.getByRole("link", { name: "Team & permissions" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Kim Evans");
  await page.getByLabel("Email").fill("kim@brightside.test");
  await page.getByLabel(/^Installer/).check();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Kim Evans added")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Kim Evans/ })).toBeVisible();

  // The last admin can't demote themselves.
  await page.getByLabel("Role for Alex Morgan").selectOption("office");
  await page.getByRole("row", { name: /Alex Morgan/ }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Your company needs at least one active admin.")).toBeVisible();
});

test("website enquiry form creates a contact and project", async ({ page, request }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/settings/marketing");
  const key = (await page.getByTestId("enquiry-key").textContent())!.trim();

  const bad = await request.post("/api/public/enquiries", { data: { key: "nope", name: "X", email: "x@example.com" } });
  expect(bad.status()).toBe(404);

  const ok = await request.post("/api/public/enquiries", {
    form: { key, name: "Web Lead", email: "web.lead@example.com", postcode: "bs1 5tr", products: "battery", message: "Is a battery worth it?" },
  });
  expect(ok.status()).toBe(201);

  await page.goto("/contacts");
  await expectInColumn(page, "New enquiry", "Web Lead");
  await page.getByRole("link", { name: "Web Lead" }).click();
  await expect(page.getByText("Is a battery worth it?")).toBeVisible();
});
