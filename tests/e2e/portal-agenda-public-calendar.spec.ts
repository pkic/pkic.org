import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ICAL from "ical.js";
import type { z } from "zod";
import { expect, test, type BrowserContext } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { publishE2eSite } from "./helpers/site-publication";
import {
  agendaSnapshotSchema,
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaRoomCreateSchema,
  agendaRevisionSchema,
} from "../../assets/shared/schemas/event-agenda";
import { agendaOccurrenceCalendarUid } from "../../assets/shared/event-agenda-calendar-identity";

const slug = "pqc-conference-amsterdam-nl";
const title = "Synthetic public calendar lifecycle session";
const movedTitle = "Synthetic moved public calendar lifecycle session";
const privateTitle = "Private planning title excluded from cancellation";
const description = "A synthetic public session describing the approved calendar lifecycle without personal data.";
const privateDescription = "Private planning notes excluded from the public calendar cancellation.";
type Release = Awaited<ReturnType<typeof publishE2eSite>>;

/** Check the actual generated file and response rather than constructing an expected calendar. */
async function staticCalendar(context: BrowserContext, release: Release, path: string) {
  const response = await context.request.get(path);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]?.split(";")[0]).toBe("text/calendar");
  expect(response.headers()["x-pkic-publication"]).toBe(`static; snapshot=${release.snapshotId}`);
  const bytes = await response.body();
  expect(bytes).toEqual(await readFile(resolve(release.directory, path.replace(/^\//, ""))));
  return new ICAL.Component(ICAL.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}
function occurrence(calendar: ICAL.Component, id: string) {
  const matches = calendar
    .getAllSubcomponents("vevent")
    .filter((entry) => entry.getFirstPropertyValue("uid") === agendaOccurrenceCalendarUid(id));
  expect(matches).toHaveLength(1);
  return matches[0]!;
}
function assertInterval(entry: ICAL.Component, startAt: string, endAt: string) {
  for (const [property, instant] of [
    ["dtstart", startAt],
    ["dtend", endAt],
  ] as const) {
    const value = entry.getFirstPropertyValue(property);
    expect(value).toBeInstanceOf(ICAL.Time);
    if (!(value instanceof ICAL.Time)) throw new Error("Calendar interval is not an iCalendar time");
    expect(value.zone.tzid).toBe("UTC");
    expect(value.toJSDate().toISOString()).toBe(instant);
    expect(entry.getFirstProperty(property)?.getParameter("tzid")).toBeUndefined();
  }
  expect(entry.toString()).toMatch(/DTSTART:\d{8}T\d{6}Z/);
  expect(entry.toString()).toMatch(/DTEND:\d{8}T\d{6}Z/);
}
test.use({ actionTimeout: 20_000 });
test("pre-generated public calendar keeps identity across correction, cancellation and reintroduction", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-public-calendar"));
  let snapshot = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  for (const name of ["Calendar lifecycle hall", "Calendar lifecycle moved hall"]) {
    const response = await page.request.post(`/api/v1/events/${slug}/agenda/rooms`, {
      data: agendaRoomCreateSchema.parse({
        expectedRevision: snapshot.revision,
        name,
        capacity: 100,
      }),
    });
    expect(response.status()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await response.json());
  }
  const firstRoom = snapshot.rooms.find((room) => room.name === "Calendar lifecycle hall")!.id;
  const secondRoom = snapshot.rooms.find((room) => room.name === "Calendar lifecycle moved hall")!.id;
  const initialStart = "2026-12-02T12:00:00.000Z",
    initialEnd = "2026-12-02T13:00:00.000Z";
  const movedStart = "2026-12-02T14:00:00.000Z",
    movedEnd = "2026-12-02T15:00:00.000Z";
  const created = await page.request.post(`/api/v1/events/${slug}/agenda/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: snapshot.revision,
      title,
      description,
      startAt: initialStart,
      endAt: initialEnd,
      roomId: firstRoom,
    }),
  });
  expect(created.status()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await created.json());
  const id = snapshot.occurrences.find((entry) => entry.title === title)!.id;
  const sessionPath = `/events/${slug}/sessions/${id}/`;
  const approve = async () => {
    const response = await page.request.post(`/api/v1/events/${slug}/agenda/publications`, {
      data: agendaRevisionSchema.parse({
        expectedRevision: snapshot.revision,
      }),
    });
    expect(response.status()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await response.json());
    const approved = agendaSnapshotSchema.parse(
      await (await page.request.get(`/api/v1/events/${slug}/agenda/previews?revision=approved`)).json(),
    );
    expect(approved.calendarPublic).toBe(true);
    expect(approved.approvedAt).toBeDefined();
    return approved;
  };
  const patch = async (changes: Omit<z.input<typeof agendaOccurrencePatchSchema>, "expectedRevision">) => {
    const response = await page.request.patch(`/api/v1/events/${slug}/agenda/occurrences/${id}`, {
      data: agendaOccurrencePatchSchema.parse({
        ...changes,
        expectedRevision: snapshot.revision,
      }),
    });
    expect(response.status()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await response.json());
  };
  const approved = await approve();
  const agendaPath = approved.publicAgendaPath!;
  expect(agendaPath).toMatch(/\/$/);
  const feedPath = `${agendaPath}calendar.ics`;
  const onePath = `${agendaPath}calendar/${encodeURIComponent(id)}.ics`;
  const publicContext = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: new URL(page.url()).origin,
  });
  const blockedRequests: string[] = [];
  await publicContext.route("**/api/**", async (route) => {
    blockedRequests.push(new URL(route.request().url()).pathname);
    await route.abort();
  });
  expect(await publicContext.cookies()).toEqual([]);
  const publicPage = await publicContext.newPage();
  try {
    let release = await publishE2eSite(page, feedPath);
    const first = occurrence(await staticCalendar(publicContext, release, feedPath), id);
    expect(first.getFirstPropertyValue("sequence")).toBe(0);
    expect(first.getFirstPropertyValue("status")).toBe("CONFIRMED");
    expect(first.getFirstPropertyValue("summary")).toBe(title);
    const stamped = first.getFirstPropertyValue("dtstamp");
    expect(stamped).toBeInstanceOf(ICAL.Time);
    if (!(stamped instanceof ICAL.Time)) throw new Error("Calendar timestamp is not an iCalendar time");
    expect(stamped.zone.tzid).toBe("UTC");
    const approvedInstant = new Date(approved.approvedAt!);
    approvedInstant.setUTCMilliseconds(0);
    expect(stamped.toJSDate().toISOString()).toBe(approvedInstant.toISOString());
    assertInterval(first, initialStart, initialEnd);
    expect(occurrence(await staticCalendar(publicContext, release, onePath), id).toString()).toBe(first.toString());
    for (const width of [1280, 390]) {
      await publicPage.setViewportSize({
        width,
        height: width === 390 ? 844 : 900,
      });
      expect((await publicPage.goto(agendaPath))!.status()).toBe(200);
      const download = publicPage.getByRole("link", {
        name: "Download calendar",
        exact: true,
      });
      const subscription = publicPage.getByRole("link", {
        name: "Subscribe to calendar",
        exact: true,
      });
      await expect(download).toHaveAttribute("href", feedPath);
      const href = await subscription.getAttribute("href");
      expect(href).toBeDefined();
      const subscriptionUrl = new URL(href!);
      expect(subscriptionUrl.protocol).toBe("webcal:");
      expect(subscriptionUrl.pathname).toBe(feedPath);
      await publicPage.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => publicPage.evaluate(() => window.scrollY)).toBe(0);
      await expect
        .poll(() => publicPage.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      await publicPage.screenshot({
        path: testInfo.outputPath(`calendar-event-${width === 390 ? "phone" : "desktop"}.png`),
        fullPage: true,
        animations: "disabled",
      });
      expect((await publicPage.goto(sessionPath))!.status()).toBe(200);
      await expect(publicPage.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(
        publicPage.getByRole("link", {
          name: "Download session calendar",
          exact: true,
        }),
      ).toHaveAttribute("href", onePath);
      await publicPage.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => publicPage.evaluate(() => window.scrollY)).toBe(0);
      await expect
        .poll(() => publicPage.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      await publicPage.screenshot({
        path: testInfo.outputPath(`calendar-session-${width === 390 ? "phone" : "desktop"}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    const downloaded = publicPage.waitForEvent("download");
    await publicPage.getByRole("link", { name: "Download session calendar", exact: true }).click();
    const download = await downloaded;
    expect(await download.failure()).toBeNull();
    const downloadedPath = testInfo.outputPath("public-session-calendar.ics");
    await download.saveAs(downloadedPath);
    expect(await readFile(downloadedPath)).toEqual(await readFile(resolve(release.directory, onePath.slice(1))));

    await patch({
      title: movedTitle,
      startAt: movedStart,
      endAt: movedEnd,
      roomId: secondRoom,
    });
    await approve();
    release = await publishE2eSite(page, feedPath);
    const moved = occurrence(await staticCalendar(publicContext, release, feedPath), id);
    expect(moved.getFirstPropertyValue("uid")).toBe(first.getFirstPropertyValue("uid"));
    expect(moved.getFirstPropertyValue("sequence")).toBe(1);
    expect(moved.getFirstPropertyValue("summary")).toBe(movedTitle);
    expect(moved.getFirstPropertyValue("location")).toBe("Calendar lifecycle moved hall");
    assertInterval(moved, movedStart, movedEnd);
    expect(occurrence(await staticCalendar(publicContext, release, onePath), id).toString()).toBe(moved.toString());

    await patch({
      visibility: "private",
      title: privateTitle,
      description: privateDescription,
    });
    await approve();
    release = await publishE2eSite(page, feedPath);
    const canceled = occurrence(await staticCalendar(publicContext, release, feedPath), id);
    expect(canceled.getFirstPropertyValue("uid")).toBe(first.getFirstPropertyValue("uid"));
    expect(canceled.getFirstPropertyValue("sequence")).toBe(2);
    expect(canceled.getFirstPropertyValue("status")).toBe("CANCELLED");
    expect(canceled.getFirstPropertyValue("summary")).toBe("Canceled session");
    expect(
      canceled
        .getAllProperties()
        .map((property) => property.name)
        .sort(),
    ).toEqual(["dtend", "dtstamp", "dtstart", "sequence", "status", "summary", "uid"]);
    assertInterval(canceled, movedStart, movedEnd);
    for (const value of [
      title,
      movedTitle,
      privateTitle,
      description,
      privateDescription,
      "Calendar lifecycle moved hall",
    ])
      expect(canceled.toString()).not.toContain(value);
    expect(occurrence(await staticCalendar(publicContext, release, onePath), id).toString()).toBe(canceled.toString());
    expect((await publicContext.request.get(sessionPath)).status()).toBe(404);

    await patch({ visibility: "public", title: movedTitle, description });
    await approve();
    release = await publishE2eSite(page, feedPath);
    const restored = occurrence(await staticCalendar(publicContext, release, feedPath), id);
    expect(restored.getFirstPropertyValue("uid")).toBe(first.getFirstPropertyValue("uid"));
    expect(restored.getFirstPropertyValue("sequence")).toBe(3);
    expect(restored.getFirstPropertyValue("status")).toBe("CONFIRMED");
    expect(restored.getFirstPropertyValue("summary")).toBe(movedTitle);
    assertInterval(restored, movedStart, movedEnd);
    expect(occurrence(await staticCalendar(publicContext, release, onePath), id).toString()).toBe(restored.toString());
    expect((await publicPage.goto(sessionPath))!.status()).toBe(200);
    await expect(
      publicPage.getByRole("link", {
        name: "Download session calendar",
        exact: true,
      }),
    ).toHaveAttribute("href", onePath);
    expect(blockedRequests).toEqual([]);
  } finally {
    await publicContext.close();
  }
});
