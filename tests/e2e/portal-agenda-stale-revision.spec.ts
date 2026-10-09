import { randomUUID } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { apiErrorPayloadSchema } from "../../assets/shared/schemas/api-common";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaRevisionSchema,
  agendaRoomCreateSchema,
  agendaSnapshotSchema,
} from "../../assets/shared/schemas/event-agenda";
import { personalAgendaResponseSchema } from "../../assets/shared/schemas/event-personal-agenda";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { roomRecommendationsResponseSchema } from "../../assets/shared/schemas/event-room-recommendations";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { createRegistrationEvent, registerStateAttendee } from "./helpers/participation-state-fixture";

/** The session dialog's live participation controls, opened over the event app's agenda. */
function participationPanel(page: Page) {
  return page.getByRole("dialog").getByRole("region", { name: "My participation", exact: true });
}

async function capture(page: Page, info: TestInfo, stage: string) {
  for (const [device, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const panel = participationPanel(page);
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    for (const field of await panel.locator("select, input, button, [role=alert]").all()) {
      if (!(await field.isVisible())) continue;
      const box = await field.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(panelBox!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(Math.min(width, panelBox!.x + panelBox!.width) + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height + 1);
    }
    await page.screenshot({ path: info.outputPath(`${stage}-${device}.png`), fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("a stale My agenda reservation refreshes the approved session and requires a second explicit submission", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const suffix = randomUUID();
  const title = `Revision workshop ${suffix.slice(0, 8)}`;
  const revisedTitle = `${title} — revised`;
  const email = `revision-attendee-${suffix}@example.test`;
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  // A fresh event: approving the shared conference agenda would also approve other specs' sessions.
  const event = await createRegistrationEvent(page, "stale-revision");
  const slug = event.slug;
  const agendaApi = `/api/v1/events/${slug}/agenda`;

  const draft = await page.request.get(agendaApi);
  expect(draft.status(), await draft.text()).toBe(200);
  let snapshot = agendaSnapshotSchema.parse(await draft.json());
  const rooms: string[] = [];
  for (const name of [`Original hall ${suffix}`, `Revised hall ${suffix}`]) {
    const response = await page.request.post(`${agendaApi}/rooms`, {
      data: agendaRoomCreateSchema.parse({ expectedRevision: snapshot.revision, name, capacity: 10 }),
    });
    expect(response.status(), await response.text()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await response.json());
    const room = snapshot.rooms.find((item) => item.name === name);
    if (!room) throw new Error("The canonical workshop room was not created");
    rooms.push(room.id);
  }
  const created = await page.request.post(`${agendaApi}/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: snapshot.revision,
      title,
      description:
        "A substantive synthetic workshop whose approved time and location change while its participant page remains open.",
      startAt: "2027-09-10T10:00:00.000Z",
      endAt: "2027-09-10T11:00:00.000Z",
      roomId: rooms[0],
      admissionPolicy: "reservation",
      capacity: 10,
      speakerUserIds: [],
    }),
  });
  expect(created.status(), await created.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await created.json());
  const occurrence = snapshot.occurrences.find((item) => item.title === title);
  if (!occurrence) throw new Error("The canonical workshop occurrence was not created");
  const publish = await page.request.post(`${agendaApi}/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: snapshot.revision }),
  });
  expect(publish.status(), await publish.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await publish.json());
  const originalRevision = snapshot.publishedRevision;
  expect(originalRevision).toBe(snapshot.revision);

  const attendeeContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const attendee = await attendeeContext.newPage();
    // The fresh event is never released to the static site; only its portal agenda is exercised.
    await registerStateAttendee(attendee, event, email, { staticRelease: false });
    await signInToPortal(attendee, email);
    const focusedPath = `/portal/#/events/${slug}/agenda?session=${occurrence.id}`;
    const initialList = attendee.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `${agendaApi}/participation` && url.searchParams.get("occurrenceId") === occurrence.id;
    });
    await attendee.goto(focusedPath);
    const initial = personalAgendaResponseSchema.parse(await (await initialList).json());
    expect(initial.sessions).toHaveLength(1);
    expect(initial.sessions[0]).toMatchObject({
      id: occurrence.id,
      title,
      publishedRevision: originalRevision,
      roomId: null,
      rooms: [{ id: rooms[0], name: `Original hall ${suffix}` }],
      status: null,
      saved: false,
    });
    // The focused link opens the session's own details over the programme.
    const dialog = attendee.getByRole("dialog");
    const detail = participationPanel(attendee);
    await expect(dialog.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(dialog.getByText(`Original hall ${suffix}`, { exact: true })).toBeVisible();
    await detail.getByLabel("Participation", { exact: true }).selectOption("reserve");
    await expect(detail.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
    await capture(attendee, info, "my-agenda-original-publication");

    const changed = await page.request.patch(`${agendaApi}/occurrences/${occurrence.id}`, {
      data: agendaOccurrencePatchSchema.parse({
        expectedRevision: snapshot.revision,
        title: revisedTitle,
        startAt: "2027-09-10T11:00:00.000Z",
        endAt: "2027-09-10T12:00:00.000Z",
        roomId: rooms[1],
      }),
    });
    expect(changed.status(), await changed.text()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await changed.json());
    const republish = await page.request.post(`${agendaApi}/publications`, {
      data: agendaRevisionSchema.parse({ expectedRevision: snapshot.revision }),
    });
    expect(republish.status(), await republish.text()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await republish.json());
    const revisedRevision = snapshot.publishedRevision;
    expect(revisedRevision).toBe(snapshot.revision);
    expect(revisedRevision).toBeGreaterThan(originalRevision!);
    // The participant page is still displaying the old approved session.
    await expect(dialog.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(attendee.getByRole("heading", { name: revisedTitle, exact: true })).toHaveCount(0);
    const writes: ReturnType<typeof sessionParticipationRequestSchema.parse>[] = [];
    const participationPath = `${agendaApi}/${occurrence.id}/participation`;
    attendee.on("request", (request) => {
      if (new URL(request.url()).pathname === participationPath && request.method() === "PUT") {
        writes.push(sessionParticipationRequestSchema.parse(request.postDataJSON()));
      }
    });
    const staleResponse = attendee.waitForResponse(
      (response) => new URL(response.url()).pathname === participationPath && response.request().method() === "PUT",
    );
    const refreshedResponse = attendee.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `${agendaApi}/participation` && url.searchParams.get("occurrenceId") === occurrence.id;
    });
    await detail.getByRole("button", { name: "Update", exact: true }).click();
    const stale = await staleResponse;
    expect(stale.status()).toBe(409);
    expect(apiErrorPayloadSchema.parse(await stale.json()).error.code).toBe("SESSION_PUBLICATION_CHANGED");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      action: "reserve",
      expectedPublishedRevision: originalRevision,
      roomId: rooms[0],
    });
    const refreshed = personalAgendaResponseSchema.parse(await (await refreshedResponse).json());
    expect(refreshed.sessions).toHaveLength(1);
    expect(refreshed.sessions[0]).toMatchObject({
      id: occurrence.id,
      title: revisedTitle,
      publishedRevision: revisedRevision,
      roomId: null,
      rooms: [{ id: rooms[1], name: `Revised hall ${suffix}` }],
      startAt: "2027-09-10T11:00:00.000Z",
      status: null,
      saved: false,
    });
    await expect(dialog.getByRole("heading", { name: revisedTitle, exact: true })).toBeVisible();
    await expect(dialog.getByText(`Revised hall ${suffix}`, { exact: true })).toBeVisible();
    await expect(detail).toContainText("confirm your choice again");
    await expect(detail.getByRole("button", { name: "Update", exact: true })).toBeEnabled();
    const demandResponse = await page.request.get(`${agendaApi}/occurrences/${occurrence.id}/room-recommendations`);
    expect(demandResponse.status(), await demandResponse.text()).toBe(200);
    const unchangedDemand = roomRecommendationsResponseSchema.parse(await demandResponse.json()).demand;
    expect(unchangedDemand.physical).toMatchObject({
      confirmed: 0,
      pending: 0,
      waitlisted: 0,
      preferences: 0,
      occupied: 0,
    });
    await capture(attendee, info, "my-agenda-refreshed-requires-submit");
    expect(writes).toHaveLength(1);

    const reservedResponse = attendee.waitForResponse(
      (response) => new URL(response.url()).pathname === participationPath && response.request().method() === "PUT",
    );
    await detail.getByRole("button", { name: "Update", exact: true }).click();
    const reserved = await reservedResponse;
    expect(reserved.status()).toBe(200);
    expect(sessionParticipationResponseSchema.parse(await reserved.json())).toMatchObject({
      status: "reserved",
      attendanceMode: "physical",
    });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      action: "reserve",
      expectedPublishedRevision: revisedRevision,
      roomId: rooms[1],
    });
    await expect(detail.getByText("Reserved", { exact: true })).toBeVisible();
    const reloadResponse = attendee.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `${agendaApi}/participation` && url.searchParams.get("occurrenceId") === occurrence.id;
    });
    await attendee.reload();
    const persisted = personalAgendaResponseSchema.parse(await (await reloadResponse).json());
    expect(persisted.sessions[0]).toMatchObject({
      id: occurrence.id,
      publishedRevision: revisedRevision,
      status: "reserved",
      roomId: rooms[1],
    });
    await expect(detail.getByText("Reserved", { exact: true })).toBeVisible();
    const finalDemandResponse = await page.request.get(
      `${agendaApi}/occurrences/${occurrence.id}/room-recommendations`,
    );
    expect(finalDemandResponse.status(), await finalDemandResponse.text()).toBe(200);
    const finalDemand = roomRecommendationsResponseSchema.parse(await finalDemandResponse.json()).demand;
    expect(finalDemand.physical).toMatchObject({ confirmed: 1, pending: 0, waitlisted: 0, occupied: 1 });
    await capture(attendee, info, "my-agenda-reserved-current-publication");
    expect(writes).toHaveLength(2);
  } finally {
    await attendeeContext.close();
  }
});
