import { openOrganizerAgenda } from "./helpers/organizer-agenda";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { agendaSnapshotSchema, agendaOccurrenceCreateSchema } from "../../assets/shared/schemas/event-agenda";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { runAgendaAction } from "./helpers/agenda-actions";

test("publication is an ellipsis action opening a dedicated review, with no action panel above the session list", async ({
  page,
}) => {
  const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/agenda-publication-layout";
  await mkdir(artifacts, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-publication-layout"));
  const endpoint = "/api/v1/events/pqc-conference-amsterdam-nl/agenda";
  const snapshot = agendaSnapshotSchema.parse(await (await page.request.get(endpoint)).json());
  const title = `Publication layout ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`${endpoint}/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: snapshot.revision,
      title,
      description: "A synthetic session for reviewing the collection layout.",
      startAt: null,
      endAt: null,
      roomId: null,
    }),
  });
  expect(created.status(), await created.text()).toBe(200);
  await openOrganizerAgenda(page, "pqc-conference-amsterdam-nl");
  await page.getByRole("tab", { name: "Schedule", exact: true }).click();
  const controls = page.getByRole("toolbar", { name: "Event sessions controls", exact: true });
  const menu = page.getByRole("button", { name: "Actions for Agenda", exact: true });
  const create = controls.getByRole("button", { name: "New session", exact: true });
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByText("Draft revision", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve for publication", exact: true })).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(controls.getByRole("button", { name: "Actions for Agenda", exact: true })).toHaveCount(0);
  await expect(create).toBeVisible();
  await expect(page.getByRole("tab", { name: "Schedule", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/sessions-final-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(menu).toBeVisible();
  const sessions = page.getByRole("table", { name: "Event sessions", exact: true });
  const head = sessions.locator("thead");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const geometry = await head.evaluate((element) => {
    const controls = [...element.querySelectorAll("th")].filter((cell) => cell.querySelector("button,input,select,a"));
    return {
      tops: controls.map((cell) => cell.getBoundingClientRect().top),
      width: element.getBoundingClientRect().width,
      staticHeaders: [...element.querySelectorAll("th")]
        .filter((cell) => !cell.querySelector("button,input,select,a"))
        .map((cell) => ({
          display: getComputedStyle(cell).display,
          clipped: getComputedStyle(cell).clipPath !== "none",
        })),
    };
  });
  expect(geometry.tops.length).toBeGreaterThan(1);
  expect(Math.max(...geometry.tops) - Math.min(...geometry.tops)).toBeLessThan(1);
  expect(geometry.width).toBeLessThanOrEqual(390);
  expect(geometry.staticHeaders.every((header) => header.display !== "none" && header.clipped)).toBe(true);
  await expect(sessions.getByRole("columnheader", { name: /^Time/ })).toBeAttached();
  const timeSort = head.getByRole("button", { name: /^Time(?: ↑| ↓)?$/, exact: false });
  await timeSort.scrollIntoViewIfNeeded();
  await timeSort.focus();
  await timeSort.press("Enter");
  await expect(sessions.getByRole("columnheader", { name: /^Time/ })).toHaveAttribute("aria-sort", "descending");
  await timeSort.focus();
  await timeSort.press("Enter");
  await expect(sessions.getByRole("columnheader", { name: /^Time/ })).toHaveAttribute("aria-sort", "ascending");
  const selectAll = head.getByRole("checkbox", { name: "Select all rows", exact: true });
  await selectAll.scrollIntoViewIfNeeded();
  await selectAll.check();
  const clearSelection = head.getByRole("checkbox", { name: "Clear selection", exact: true });
  await expect(clearSelection).toBeChecked();
  await clearSelection.uncheck();
  const dayOptions = head.getByRole("button", { name: "Day column options", exact: true });
  await dayOptions.scrollIntoViewIfNeeded();
  await dayOptions.focus();
  await dayOptions.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  const chooseColumns = head.getByRole("button", { name: "Choose columns", exact: true });
  await chooseColumns.scrollIntoViewIfNeeded();
  await chooseColumns.focus();
  await chooseColumns.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await head.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/sessions-final-phone.png`, fullPage: true });
  await runAgendaAction(page, "Review for publication");
  await expect(page.getByRole("heading", { name: "Review for publication", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("Draft revision", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve for publication", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/publication-final-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/publication-final-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Back to agenda", exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(page.getByText("Draft revision", { exact: true })).toHaveCount(0);
});
