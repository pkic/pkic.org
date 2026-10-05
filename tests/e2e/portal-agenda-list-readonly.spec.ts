import { expect, test, type Page, type Response } from "@playwright/test";
import { agendaOccurrenceListSchema, agendaOccurrenceQuerySchema } from "../../assets/shared/schemas/event-agenda";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { prepareAgendaListFixture } from "./helpers/agenda-list-fixture";

test.use({ actionTimeout: 20_000 });

async function chooseColumn(page: Page, header: string, choice: string) {
  await page.getByRole("button", { name: `${header} column options`, exact: true }).click();
  await page.getByRole("menuitemradio", { name: choice, exact: true }).click();
}

test("server agenda sort, day filters and nonempty pagination preserve schedule and cross-page selection", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-list-readonly"));
  const fixture = await prepareAgendaListFixture(page);
  const before = await fixture.read();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith(fixture.endpoint) && request.method() !== "GET")
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.goto(fixture.workspace);
  await page.getByRole("tab", { name: "All sessions", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "All sessions", exact: true });
  const table = panel.getByRole("table", { name: "Sessions across all days", exact: true });
  await expect(table).toBeVisible();
  const path = `${fixture.endpoint}/occurrences`;
  async function query(
    action: () => Promise<unknown>,
    expected: { sort?: string; offset?: number; limit?: number; day?: string; q?: string },
    titles?: string[],
  ) {
    const receiving = page.waitForResponse(
      (response: Response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === path &&
          Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === String(value))
        );
      },
      { timeout: 20_000 },
    );
    await action();
    const response = await receiving;
    expect(response.status()).toBe(200);
    const request = agendaOccurrenceQuerySchema.parse(Object.fromEntries(new URL(response.url()).searchParams));
    expect(request).toMatchObject(expected);
    const result = agendaOccurrenceListSchema.parse(await response.json());
    if (titles) expect(result.occurrences.map((row) => row.title)).toEqual(titles);
    await expect
      .poll(() =>
        table
          .locator("tbody .pk-table__checkbox")
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))),
      )
      .toEqual(result.occurrences.map((row) => row.title));
    expect(await fixture.read()).toEqual(before);
    return result;
  }
  const ordered = [...before.occurrences].sort((left, right) => left.title.localeCompare(right.title));
  const titles = ordered.map((row) => row.title);
  const sized = await query(() => panel.getByLabel("Rows per page", { exact: true }).selectOption("25"), {
    limit: 25,
    offset: 0,
  });
  expect(sized.page).toMatchObject({ total: 56, hasMore: true });
  await query(
    () => chooseColumn(page, "Session", "Sort ascending"),
    { sort: "title", limit: 25, offset: 0 },
    titles.slice(0, 25),
  );
  await table.getByRole("checkbox", { name: titles[0]!, exact: true }).check();
  const second = await query(
    () => panel.getByRole("button", { name: "Next page", exact: true }).click(),
    { sort: "title", limit: 25, offset: 25 },
    titles.slice(25, 50),
  );
  expect(second.page).toMatchObject({ total: 56, hasMore: true });
  await table.getByRole("checkbox", { name: titles[26]!, exact: true }).check();
  const last = await query(
    () => panel.getByRole("button", { name: "Next page", exact: true }).click(),
    { sort: "title", limit: 25, offset: 50 },
    titles.slice(50),
  );
  expect(last.page).toMatchObject({ total: 56, hasMore: false });
  await expect(panel.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  expect(last.occurrences.filter((row) => row.startAt === null)).toHaveLength(4);
  await query(
    () => chooseColumn(page, "Session", "Sort descending"),
    { sort: "-title", limit: 25, offset: 0 },
    [...titles].reverse().slice(0, 25),
  );
  await query(
    () => chooseColumn(page, "Session", "Sort ascending"),
    { sort: "title", limit: 25, offset: 0 },
    titles.slice(0, 25),
  );
  await expect(table.getByRole("checkbox", { name: titles[0]!, exact: true })).toBeChecked();

  const dayTitles = titles.filter((title) => title.includes("Alpha"));
  const filtered = await query(
    async () => {
      await page.getByRole("button", { name: "Day column options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Filter", exact: true }).click();
      const dayChoice = page.getByRole("menuitemradio").filter({ hasText: /Sep.*10.*2027/ });
      await expect(dayChoice).toHaveCount(1);
      await dayChoice.click();
    },
    { day: fixture.days[0], sort: "title", limit: 25, offset: 0 },
    dayTitles.slice(0, 25),
  );
  expect(filtered.page.total).toBe(26);
  expect(filtered.occurrences.every((row) => row.startAt?.startsWith(fixture.days[0]))).toBe(true);
  const dayLast = await query(
    () => panel.getByRole("button", { name: "Next page", exact: true }).click(),
    { day: fixture.days[0], sort: "title", limit: 25, offset: 25 },
    dayTitles.slice(25),
  );
  expect(dayLast.page).toMatchObject({ total: 26, hasMore: false });
  await query(
    async () => {
      await page.getByRole("button", { name: "Day column options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Filter", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "All days", exact: true }).click();
    },
    { sort: "title", limit: 25, offset: 0 },
    titles.slice(0, 25),
  );
  const unscheduled = titles.filter((title) => title.includes("Unscheduled"));
  const searched = await query(
    async () => {
      const search = panel.getByPlaceholder("Search sessions…", { exact: true });
      await search.fill("Unscheduled");
      await search.press("Enter");
    },
    { q: "Unscheduled", sort: "title", offset: 0, limit: 25 },
    unscheduled,
  );
  expect(searched.page).toMatchObject({ total: 4, hasMore: false });
  expect(searched.occurrences.every((row) => row.startAt === null && row.endAt === null)).toBe(true);
  await panel.getByRole("button", { name: "Move selected sessions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Move 2 selected sessions", exact: true })).toBeVisible();
  expect(await fixture.read()).toEqual(before);
  await page.getByRole("button", { name: "Cancel bulk move", exact: true }).click();
  await page.getByRole("tab", { name: "Agenda", exact: true }).click();
  expect(await fixture.read()).toEqual(before);
  const restored = await query(
    () => page.getByRole("tab", { name: "All sessions", exact: true }).click(),
    { q: "Unscheduled", sort: "title", offset: 0, limit: 25 },
    unscheduled,
  );
  expect(restored.page).toMatchObject({ total: 4, hasMore: false });
  expect(restored.occurrences.every((row) => row.startAt === null && row.endAt === null)).toBe(true);
  await expect(panel.getByPlaceholder("Search sessions…", { exact: true })).toHaveValue("Unscheduled");
  await panel.getByRole("button", { name: "Move selected sessions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Move 2 selected sessions", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel bulk move", exact: true }).click();
  expect(await fixture.read()).toEqual(before);
  expect(writes).toEqual([]);
  for (const [device, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`agenda-readonly-list-${device}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  expect(await fixture.read()).toEqual(before);
  expect(writes).toEqual([]);
});
