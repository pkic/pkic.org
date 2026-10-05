import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { runRowAction } from "./helpers/data-table";
import {
  agendaSnapshotSchema,
  agendaRoomCreateSchema,
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
} from "../../assets/shared/schemas/event-agenda";
import { agendaScheduleConflictDetailsSchema } from "../../assets/shared/schemas/event-agenda-schedule";
import { apiErrorPayloadSchema } from "../../assets/shared/schemas/api-common";
import { auditLogListQuerySchema, auditLogListResponseSchema } from "../../assets/shared/schemas/audit-log";
import { groupEventCreateSchema, groupEventDetailResponseSchema } from "../../assets/shared/schemas/group-events";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../assets/shared/timezone";
import { formatTimeRangeInZone } from "../../assets/shared/format-date";

async function capture(page: Page, info: TestInfo, name: string) {
  for (const [label, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`${name}-${label}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("real room refusal preserves the dedicated session draft and succeeds after explicit correction", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const suffix = crypto.randomUUID();
  const title = `Conflict editor ${suffix}`;
  const draftTitle = `Retained draft ${suffix}`;
  const blockerTitle = `Occupied room ${suffix}`;
  const roomName = `Conflict diagnostics hall ${suffix}`;
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  const groupId = "20000000-0000-4000-8000-000000000003";
  const eventResponse = await page.request.post(`/api/v1/groups/${groupId}/events`, {
    data: groupEventCreateSchema.parse({
      slug: `agenda-conflict-${suffix}`,
      name: "Synthetic scheduling diagnostics",
      profileKey: "conference",
      visibility: "public",
      registrationPolicy: "no_registration",
      timezone: "Europe/Amsterdam",
      startsAt: dateTimeLocalToIso("2026-12-01T09:00", "Europe/Amsterdam"),
      endsAt: dateTimeLocalToIso("2026-12-01T17:00", "Europe/Amsterdam"),
      links: [],
    }),
  });
  expect(eventResponse.status(), await eventResponse.text()).toBe(201);
  const event = groupEventDetailResponseSchema.parse(await eventResponse.json()).event;
  const slug = event.slug;
  const base = `/api/v1/events/${slug}/agenda`;
  let response = await page.request.get(base);
  expect(response.status(), await response.text()).toBe(200);
  let snapshot = agendaSnapshotSchema.parse(await response.json());
  expect(snapshot.eventStartsAt).toBeTruthy();
  expect(snapshot.eventEndsAt).toBeTruthy();
  const start = Date.parse(snapshot.eventStartsAt!);
  const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
  expect(Date.parse(at(180))).toBeLessThanOrEqual(Date.parse(snapshot.eventEndsAt!));
  response = await page.request.post(`${base}/rooms`, {
    data: agendaRoomCreateSchema.parse({ expectedRevision: snapshot.revision, name: roomName, capacity: 20 }),
  });
  expect(response.status(), await response.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await response.json());
  const roomId = snapshot.rooms.find((room) => room.name === roomName)!.id;
  for (const [sessionTitle, from, until] of [
    [blockerTitle, 60, 120],
    [title, 120, 180],
  ] as const) {
    response = await page.request.post(`${base}/occurrences`, {
      data: agendaOccurrenceCreateSchema.parse({
        expectedRevision: snapshot.revision,
        title: sessionTitle,
        description: "A self-contained room scheduling diagnostic fixture.",
        startAt: at(from),
        endAt: at(until),
        roomId,
      }),
    });
    expect(response.status(), await response.text()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await response.json());
  }
  const occurrence = snapshot.occurrences.find((item) => item.title === title)!;
  const before = snapshot;
  const auditQuery = auditLogListQuerySchema.parse({
    entityType: "event_agenda",
    entityId: event.id,
    limit: 100,
    offset: 0,
  });
  const audit = async () => {
    const result = await page.request.get("/api/v1/audit-log", {
      params: {
        entityType: auditQuery.entityType!,
        entityId: auditQuery.entityId!,
        limit: auditQuery.limit,
        offset: auditQuery.offset,
      },
    });
    expect(result.status(), await result.text()).toBe(200);
    return auditLogListResponseSchema.parse(await result.json());
  };
  const auditBefore = await audit();
  await page.goto(`/portal/#/events/${slug}/agenda`);
  await page.getByRole("button", { name: `Open session details: ${title}`, exact: true }).click();
  await runRowAction(page, page.getByRole("dialog", { name: title, exact: true }), "Edit / move session");
  await expect(page.getByRole("heading", { name: "Edit session", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("textbox", { name: /^Session title/ }).fill(draftTitle);
  await page.getByLabel("Starts", { exact: true }).fill(instantToDateTimeLocal(at(75), snapshot.timeZone));
  await page.getByLabel("Ends", { exact: true }).fill(instantToDateTimeLocal(at(105), snapshot.timeZone));
  const refused = page.waitForResponse(
    (result) =>
      new URL(result.url()).pathname === `${base}/occurrences/${occurrence.id}` &&
      result.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  const refusal = await refused;
  expect(refusal.status(), await refusal.text()).toBe(409);
  const attempted = agendaOccurrencePatchSchema.parse(refusal.request().postDataJSON());
  expect(attempted.title).toBe(draftTitle);
  expect(attempted.expectedRevision).toBe(before.revision);
  const error = apiErrorPayloadSchema.parse(await refusal.json());
  expect(error.error.code).toBe("AGENDA_SCHEDULE_CONFLICT");
  const details = agendaScheduleConflictDetailsSchema.parse(error.error.details);
  expect(details.proposal?.occurrences.map((item) => item.id)).toContain(occurrence.id);
  const diagnostics = page.getByRole("region", { name: "Schedule conflict details", exact: true });
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics).toContainText(draftTitle);
  await expect(diagnostics).toContainText(blockerTitle);
  await expect(diagnostics).toContainText(roomName);
  await expect(diagnostics).toContainText(snapshot.timeZone);
  await expect(diagnostics).toContainText(formatTimeRangeInZone(at(75), at(105), snapshot.timeZone));
  await expect(page.getByRole("textbox", { name: /^Session title/ })).toHaveValue(draftTitle);
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue(
    instantToDateTimeLocal(at(75), snapshot.timeZone),
  );
  response = await page.request.get(base);
  expect(response.status(), await response.text()).toBe(200);
  expect(agendaSnapshotSchema.parse(await response.json())).toEqual(before);
  expect(await audit()).toEqual(auditBefore);
  await capture(page, info, "schedule-refusal-retained-draft");
  await page.getByLabel("Starts", { exact: true }).fill(instantToDateTimeLocal(at(120), snapshot.timeZone));
  await page.getByLabel("Ends", { exact: true }).fill(instantToDateTimeLocal(at(180), snapshot.timeZone));
  const corrected = page.waitForResponse(
    (result) =>
      new URL(result.url()).pathname === `${base}/occurrences/${occurrence.id}` &&
      result.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  const saved = await corrected;
  expect(saved.status(), await saved.text()).toBe(200);
  const correction = agendaOccurrencePatchSchema.parse(saved.request().postDataJSON());
  expect(correction.expectedRevision).toBe(before.revision);
  snapshot = agendaSnapshotSchema.parse(await saved.json());
  expect(snapshot.revision).toBe(before.revision + 1);
  expect(snapshot.occurrences.find((item) => item.id === occurrence.id)).toMatchObject({
    title: draftTitle,
    startAt: at(120),
    endAt: at(180),
    roomId,
  });
  await expect(page.getByRole("heading", { name: "Edit session", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Open session details: ${draftTitle}`, exact: true })).toBeVisible();
  await capture(page, info, "schedule-corrected-explicit-retry");
});
