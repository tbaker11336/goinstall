import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./helpers";

// Solar designer tools on the plan (static view: the e2e server has no
// Google keys): drag to fill panels, wire strings, mark equipment, draw a
// cable, measure, and download the design and single line diagram PDFs.
// Runs after phase3-design, which sets the edge setback (0.4 m).

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 1400 } });

/** Screen position of a plan point (metres), measured now: the layout moves as cards appear. */
function planAt(page: Page, view: { cx: number; cy: number; size: number }) {
  return async (x: number, y: number) => {
    const box = (await page.getByRole("img", { name: /Roof plan/ }).boundingBox())!;
    // The square plan is fitted inside the (possibly wider) image.
    const k = Math.min(box.width, box.height) / view.size;
    return { x: box.x + box.width / 2 + (x - view.cx) * k, y: box.y + box.height / 2 + (y - view.cy) * k };
  };
}

test("drag-fill, strings, markers, cable, measure and downloads", async ({ page }) => {
  await signInAs(page, "Alex Morgan");
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Rachel Bennett" }).click();
  await page.getByRole("link", { name: /8 Elm Close/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: /Design$/ }).click();
  await page.waitForURL(/\/design$/);
  // No server key here, so no postcode search; the plan is drawn on a grid.
  await expect(page.getByRole("search")).toHaveCount(0);

  const tools = page.getByRole("toolbar", { name: "Design tools" });
  await tools.getByRole("button", { name: "Draw roof" }).click();
  const empty = (await page.getByRole("img", { name: /Roof plan/ }).boundingBox())!;
  await page.mouse.click(empty.x + empty.width / 2, empty.y + empty.height / 2);
  await expect(page.getByRole("button", { name: /Roof A · south · 35° · 0 panels/ })).toBeVisible();
  // One 8 m × 5 m roof at the centre: the view is 24 m square around it.
  const at = planAt(page, { cx: 0, cy: 0, size: 24 });

  // Drag across the roof (35° pitch: 4.1 m deep on plan) to fill it.
  await tools.getByRole("button", { name: "Panels" }).click();
  const from = await at(-3.9, -2);
  const to = await at(3.9, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("status").filter({ hasText: /12 panels added to Roof A/ })).toBeVisible();

  // Wire them: the 445 W panel and 5 kW inverter take one roof per MPPT input.
  const strings = page.getByRole("region", { name: "Strings" });
  await strings.getByRole("button", { name: "Auto-assign" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Wired into 1 string/ })).toBeVisible();
  await expect(strings.getByText("Wired by hand")).toBeVisible();
  await expect(strings.getByText("12 panels")).toBeVisible();
  // Take two panels off by hand with the Strings tool: the card says they aren't wired.
  await tools.getByRole("button", { name: "Strings" }).click();
  await expect(page.getByRole("radio", { name: /String 1/ })).toBeChecked();
  const p1 = await at(-3.9 + 0.4 + 0.57, -2 + 0.4 + 0.72);
  await page.mouse.click(p1.x, p1.y);
  await expect(strings.getByText("11 panels")).toBeVisible();
  await expect(page.getByText("1 panel isn't on a string yet.")).toBeVisible();
  await page.mouse.click(p1.x, p1.y);
  await expect(strings.getByText("12 panels")).toBeVisible();

  // Mark the inverter and meter box off the roof.
  for (const [kind, x, y] of [["Inverter", -8, 6], ["Meter box", 8, 6]] as const) {
    await tools.getByRole("button", { name: "Mark" }).click();
    await page.getByLabel("Mark", { exact: true }).selectOption({ label: kind });
    const p = await at(x, y);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByRole("status").filter({ hasText: `${kind} marked` })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /^Inverter\. Arrow keys/ })).toBeVisible();

  // An AC cable from the inverter to the meter box (points snap to the markers): 16 m on plan.
  await tools.getByRole("button", { name: "Cable" }).click();
  await page.getByLabel("Cable", { exact: true }).selectOption("ac");
  for (const [x, y] of [[-7.8, 6.1], [-8, 9], [8, 9], [8.2, 5.9]]) {
    const p = await at(x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.getByRole("button", { name: "Finish cable" }).click();
  await expect(page.getByRole("status").filter({ hasText: /AC cable added: 22 m/ })).toBeVisible();
  const plan = page.getByRole("region", { name: "Site plan" });
  await plan.getByLabel("Extra (drops, loops)").fill("3");
  await expect(plan.getByText("Cable to order: AC 25 m")).toBeVisible();

  // Measure along the ridge side: 6 m.
  await tools.getByRole("button", { name: "Measure" }).click();
  const a = await at(-3, 10);
  const b = await at(3, 10);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect(plan.getByText(/Measurement 1: 6(\.0\d)? m/)).toBeVisible();

  // A note on the meter box, then everything is saved and comes back on reload.
  await plan.getByLabel("Meter box note").fill("Meter in porch cupboard");
  await expect(page.getByText(/Saved .* ago|Saved just now/)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByRole("region", { name: "Strings" }).getByText("Wired by hand")).toBeVisible();
  await expect(plan.getByText("Cable to order: AC 25 m")).toBeVisible();
  await expect(plan.getByLabel("Meter box note")).toHaveValue("Meter in porch cupboard");
  await expect(page.getByRole("button", { name: /^Meter box: Meter in porch cupboard/ })).toBeVisible();

  // Keyboard alternative to dragging a marker.
  await page.getByRole("button", { name: /^Inverter\. Arrow keys/ }).focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(page.getByText(/Saving…/)).toBeVisible();

  for (const name of ["Download design", "Download SLD"]) {
    const href = await page.getByRole("link", { name }).getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    const body = await res.body();
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(2000);
  }
});
