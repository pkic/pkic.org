import { instantToCalendarDate } from "../../assets/shared/timezone";
import { writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { z } from "zod";
import { personalAgendaResponseSchema } from "../../assets/shared/schemas/event-personal-agenda";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { signInToPortal } from "./helpers/portal-auth";
import { prepareParticipationStates, registerStateAttendee } from "./helpers/participation-state-fixture";
import { ownDomainEmail } from "./helpers/registration";
import { sessionAdmissionNote } from "../../assets/shared/event-participation-link";
import { createRegistrationEvent } from "./helpers/participation-state-fixture";
import {
  agendaOccurrenceCreateSchema,
  agendaRoomCreateSchema,
  agendaRevisionSchema,
  agendaSnapshotSchema,
} from "../../assets/shared/schemas/event-agenda";
import { locationLiveStreamUpdateSchema } from "../../assets/shared/schemas/event-live-stream";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import {
  organizationCreateSchema,
  organizationCreateResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { identityCreateSchema, identityMutationResponseSchema } from "../../assets/shared/schemas/identity";

test("session stream joining follows its window and old links explain the requested session", async ({
  page,
}, info) => {
  await signInAsE2eStaff(page, e2eAdminEmail("session-timing"));
  const now = Date.now();
  await page.clock.install({ time: now });
  const event = await createRegistrationEvent(
    page,
    "session-timing",
    [-1, 0, 1].map((offset) => ({
      date: new Date(now + offset * 86_400_000).toISOString().slice(0, 10),
      startTime: "00:00",
      endTime: "23:55",
    })),
  );
  const base = `/api/v1/events/${event.slug}/agenda`;
  let agenda = agendaSnapshotSchema.parse(await (await page.request.get(base)).json());
  const rooms = [];
  for (const [name, videoId] of [
    ["Timing test hall", "dQw4w9WgXcQ"],
    ["Timing test studio", "jfKfPfyJRdk"],
  ] as const) {
    const roomResponse = await page.request.post(`${base}/rooms`, {
      data: agendaRoomCreateSchema.parse({
        expectedRevision: agenda.revision,
        name,
        capacity: 120,
        equipment: ["live_streaming"],
      }),
    });
    expect(roomResponse.status(), await roomResponse.text()).toBe(200);
    agenda = agendaSnapshotSchema.parse(await roomResponse.json());
    const room = agenda.rooms.find((candidate) => candidate.name === name)!;
    rooms.push(room);
    const stream = await page.request.put(`${base}/rooms/${room.id}/stream`, {
      data: locationLiveStreamUpdateSchema.parse({ videoId, days: [] }),
    });
    expect(stream.status(), await stream.text()).toBe(200);
  }
  const roomId = rooms[0]!.id;
  const studioId = rooms[1]!.id;
  const sessions = [];
  for (const [title, start, end] of [
    ["Ended timing session", -60, -30],
    ["Current timing session", -5, 5],
    ["Future timing session", 30, 35],
  ] as const) {
    const response = await page.request.post(`${base}/occurrences`, {
      data: agendaOccurrenceCreateSchema.parse({
        expectedRevision: agenda.revision,
        title,
        description: "Synthetic session for online joining boundary verification.",
        startAt: new Date(now + start * 60_000).toISOString(),
        endAt: new Date(now + end * 60_000).toISOString(),
        roomId: title === "Future timing session" ? studioId : roomId,
        admissionPolicy: "preference",
        accessPolicy: "open",
        speakerUserIds: [],
      }),
    });
    expect(response.status(), await response.text()).toBe(200);
    agenda = agendaSnapshotSchema.parse(await response.json());
    sessions.push(agenda.occurrences.find((session) => session.title === title)!);
  }
  const published = await page.request.post(`${base}/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: agenda.revision }),
  });
  expect(published.status(), await published.text()).toBe(200);
  const actor = userAuthSessionResponseSchema.parse(await (await page.request.get("/api/v1/auth/session")).json());
  const organization = await page.request.post("/api/v1/organizations", {
    data: organizationCreateSchema.parse({ name: `Synthetic Timing Services ${crypto.randomUUID().slice(0, 8)}` }),
  });
  expect(organization.status(), await organization.text()).toBe(201);
  const organizationId = organizationCreateResponseSchema.parse(await organization.json()).organization.id;
  const represented = await page.request.post(`/api/v1/organizations/${organizationId}/identities`, {
    data: identityCreateSchema.parse({
      userReference: "existing_user",
      userId: actor.identity.id,
      jobTitle: "Timing test attendee",
      activation: { mode: "immediate", reason: "Synthetic timing regression fixture" },
    }),
  });
  expect(represented.status(), await represented.text()).toBe(201);
  const identityId = identityMutationResponseSchema.parse(await represented.json()).identityId;
  await registerStateAttendee(page, event, e2eAdminEmail("session-timing"), { staticRelease: false, identityId });
  // Keep the test independent of a third-party video player's network and consent behavior.
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Synthetic stream player</p>" }),
  );
  const capture = async (name: string) => {
    for (const [width, height, device] of [
      [1280, 900, "desktop"],
      [375, 812, "phone"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: info.outputPath(`${name}-${device}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  };
  for (const session of sessions) {
    await page.goto(`/portal/#/events/${event.slug}/agenda?session=${session.id}`);
    const dialog = page.getByRole("dialog", { name: session.title, exact: true });
    await expect(dialog).toBeVisible();
    const join = dialog.getByRole("link", { name: "Join online", exact: true });
    if (session.title === "Current timing session") {
      await expect(join).toBeVisible();
      await capture("join-online-current");
      await join.click();
      await expect(page.getByText("Current timing session", { exact: true }).first()).toBeVisible();
    } else await expect(join).toBeHidden();
  }
  for (const session of [sessions[0]!, sessions[2]!]) {
    await page.goto(`/portal/#/events/${event.slug}/virtual?room=${roomId}&session=${session.id}`);
    const notice = page.getByRole("status").filter({ hasText: session.title });
    await expect(notice).toContainText(session === sessions[0] ? "has ended" : "starts");
    await expect(notice).toContainText(session === sessions[0] ? "Timing test hall" : "Timing test studio");
    if (session === sessions[2]) await expect(page.getByTitle("Timing test studio live stream")).toBeHidden();
    await capture(session === sessions[0] ? "room-ended-link" : "room-future-link");
  }
  await page.goto(`/portal/#/events/${event.slug}/agenda?session=${sessions[2]!.id}`);
  const future = page.getByRole("dialog", { name: sessions[2]!.title, exact: true });
  await expect(future).toBeVisible();
  await expect(future.getByRole("link", { name: "Join online", exact: true })).toBeHidden();
  await page.clock.fastForward(15 * 60_000 + 1000);
  const joinFuture = future.getByRole("link", { name: "Join online", exact: true });
  await expect(joinFuture).toBeVisible();
  await joinFuture.click();
  const notice = page.getByRole("status").filter({ hasText: sessions[2]!.title });
  await expect(notice).toContainText("starts");
  await expect(page.getByTitle("Timing test studio live stream")).toHaveAttribute("src", /jfKfPfyJRdk/);
  // The old hall ID in a saved link must not override the session's current studio.
  await page.goto(`/portal/#/events/${event.slug}/virtual?room=${roomId}&session=${sessions[2]!.id}`);
  await expect(page.getByTitle("Timing test studio live stream")).toBeVisible();
  await capture("room-moved-session-join-window");
  await page.clock.fastForward(15 * 60_000);
  await expect(notice).toBeHidden();
  await page.clock.fastForward(5 * 60_000);
  await expect(notice).toContainText("has ended");
});

type Fixture = Awaited<ReturnType<typeof prepareParticipationStates>>;
type Occurrence = Fixture["agenda"]["occurrences"][number];
type Personal = z.infer<typeof personalAgendaResponseSchema>["sessions"][number];
type Participation = z.infer<typeof sessionParticipationRequestSchema>;

async function readSession(page: Page, fixture: Fixture, occurrence: Occurrence) {
  const response = await page.request.get(`${fixture.base}/participation`, { params: { occurrenceId: occurrence.id } });
  expect(response.status()).toBe(200);
  const parsed = personalAgendaResponseSchema.parse(await response.json());
  expect(parsed.sessions).toHaveLength(1);
  const session = parsed.sessions[0]!;
  expect(session.id).toBe(occurrence.id);
  expect(session.publishedRevision).toBe(fixture.agenda.publishedRevision);
  return session;
}

/** The live participation action bar, after the abstract and speakers in the event app's session details. */
function participation(page: Page) {
  return page.getByRole("dialog").getByRole("region", { name: "Participation", exact: true });
}

/** How the session admits people: one fine line in the session details' header, above the participation bar. */
function admissionNote(page: Page, policy: Parameters<typeof sessionAdmissionNote>[0]) {
  return page.getByRole("dialog").getByText(sessionAdmissionNote(policy), { exact: true });
}

/** Activate a control with the keyboard, as an assistive-technology user would. */
async function press(page: Page, control: Locator) {
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press("Enter");
}

/** Follow the actual static link, using native keyboard activation rather than a portal shortcut. */
async function followPublic(
  page: Page,
  fixture: Fixture,
  occurrence: Occurrence,
  label: string,
  { participates = true }: { participates?: boolean } = {},
) {
  const response = await page.goto(fixture.agenda.publicAgendaPath!);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-pkic-publication"]).toBe(`static; snapshot=${fixture.release.snapshotId}`);
  const card = page.locator(`article[data-agenda-occurrence="${occurrence.id}"]`);
  await expect(card).toBeVisible();
  const link = card.getByRole("link", { name: label, exact: true });
  await expect(link).toHaveAttribute("href", `/portal/#/events/${fixture.slug}/agenda?session=${occurrence.id}`);
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  // The portal settles the deep link on the program day that holds the session.
  if (!occurrence.startAt) throw new Error("The participation fixture requires a scheduled occurrence");
  const day = instantToCalendarDate(occurrence.startAt, fixture.agenda.timeZone);
  await expect(page).toHaveURL(
    new URL(`/portal/#/events/${fixture.slug}/agenda/${day}?session=${occurrence.id}`, page.url()).href,
  );
  // The deep link opens the session's own details over the whole program.
  const dialog = page.getByRole("dialog", { name: occurrence.title, exact: true });
  await expect(dialog.getByRole("heading", { name: occurrence.title, exact: true })).toBeVisible();
  // Someone not invited to an invitation-only session has nothing to do there; its header states the rule.
  if (participates) await expect(participation(page)).toBeVisible();
  else await expect(participation(page)).toHaveCount(0);
}

/** Take the one seat action the session's rule offers; nothing asks for a room or an attendance mode. */
async function submit(
  page: Page,
  fixture: Fixture,
  occurrence: Occurrence,
  action: Participation["action"],
  label: string,
) {
  const detail = participation(page);
  await expect(detail.locator("select")).toHaveCount(0);
  const update = detail.getByRole("button", { name: label, exact: true });
  await expect(update).toBeEnabled();
  await update.focus();
  await expect(update).toBeFocused();
  const received = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${fixture.base}/occurrences/${occurrence.id}/participation` &&
      response.request().method() === "PUT",
  );
  await page.keyboard.press("Enter");
  const response = await received;
  expect(response.status()).toBe(200);
  const body = sessionParticipationRequestSchema.parse(response.request().postDataJSON());
  expect(body).toEqual({ action, expectedPublishedRevision: fixture.agenda.publishedRevision });
  return { request: body, receipt: sessionParticipationResponseSchema.parse(await response.json()) };
}

/** Canceling is a separate, quiet and confirmed command beside the held seat's status. */
async function cancelRegistration(page: Page, fixture: Fixture, occurrence: Occurrence) {
  const detail = participation(page);
  const received = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${fixture.base}/occurrences/${occurrence.id}/participation` &&
      response.request().method() === "PUT",
  );
  await press(page, detail.getByRole("button", { name: "Cancel reservation…", exact: true }));
  // The session details are themselves a dialog, so the destructive confirmation is reached by its own role.
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText(`Cancel reservation for ${occurrence.title}?`);
  await confirmation.getByRole("button", { name: "Cancel reservation", exact: true }).click();
  const response = await received;
  expect(response.status()).toBe(200);
  const body = sessionParticipationRequestSchema.parse(response.request().postDataJSON());
  expect(body).toEqual({ action: "cancel" });
  return { request: body, receipt: sessionParticipationResponseSchema.parse(await response.json()) };
}

async function capture(page: Page, info: TestInfo, name: string, panel: Locator) {
  for (const [device, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 375, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    for (const control of await panel.locator("button, a").all()) {
      if (!(await control.isVisible())) continue;
      const rect = await control.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(Math.min(width, bounds!.x + bounds!.width) + 1);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
    }
    await page.screenshot({ path: info.outputPath(`${name}-${device}.png`), fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

const BOOKED: ReadonlyArray<Personal["status"]> = ["reserved", "waitlisted", "approval_pending"];

/** Both the session details and the event app's My agenda tab must expose the same state after reload. */
async function inspectState(
  page: Page,
  fixture: Fixture,
  occurrence: Occurrence,
  label: string,
  status: Personal["status"],
  info: TestInfo,
  { stateInHeader = false, rowLabel = label }: { stateInHeader?: boolean; rowLabel?: string } = {},
) {
  if (!occurrence.startAt) throw new Error("The participation fixture requires a scheduled occurrence");
  const agendaDayPath = `/portal/#/events/${fixture.slug}/agenda/${instantToCalendarDate(occurrence.startAt, fixture.agenda.timeZone)}`;
  const before = await readSession(page, fixture, occurrence);
  expect(before.status).toBe(status);
  const panel = stateInHeader ? page.getByRole("dialog") : participation(page);
  // A booking shows as the reader's status; without one, the seat action or its one-line reason is the state.
  const stateLabel = panel.getByText(label, { exact: true }).first();
  await expect(panel).toContainText(label);
  await expect(stateLabel).toBeVisible();
  // Details opened from a card are not part of the URL; reload the session's own deep link.
  await page.goto(`/portal/#/events/${fixture.slug}/agenda?session=${occurrence.id}`);
  await page.reload();
  await expect(panel).toContainText(label);
  await expect(stateLabel).toBeVisible();
  const persisted = await readSession(page, fixture, occurrence);
  expect(persisted.status).toBe(status);
  await capture(page, info, label.toLowerCase().replaceAll(" ", "-"), panel);
  const dialog = page.getByRole("dialog", { name: occurrence.title, exact: true });
  await press(page, dialog.getByRole("button", { name: "Close session details", exact: true }));
  await expect(dialog).toBeHidden();
  // Phones reach My agenda through the event app's bottom tabs.
  const tabs = page.getByRole("navigation", { name: "Event app", exact: true });
  await press(page, tabs.getByRole("link", { name: "My agenda", exact: true }));
  await expect(page).toHaveURL(new URL(`${agendaDayPath}?mine=1`, page.url()).href);
  const sessionLink = page
    .getByRole("link", { name: occurrence.title, exact: true })
    .and(page.locator(`a[href="#/events/${fixture.slug}/agenda?mine=1&session=${occurrence.id}"]`));
  const row = page.getByRole("listitem").filter({ has: sessionLink });
  // Taking a seat stars the session, and a released seat stays on My agenda while it is starred.
  if (BOOKED.includes(status) || before.saved) {
    await expect(row).toBeVisible();
    await expect(row).toContainText(rowLabel);
    await press(page, sessionLink);
  } else {
    // Only starred and booked sessions are on My agenda; the whole program still lists this one.
    await expect(row).toBeHidden();
    await press(page, tabs.getByRole("link", { name: "Agenda", exact: true }));
    await expect(page).toHaveURL(new URL(agendaDayPath, page.url()).href);
    const card = page.locator(`article[data-agenda-occurrence="${occurrence.id}"]`);
    await expect(card).toBeVisible();
    await press(page, card.getByLabel(`Open session details: ${occurrence.title}`, { exact: true }));
  }
  await expect(dialog.getByRole("heading", { name: occurrence.title, exact: true })).toBeVisible();
  await expect(stateLabel).toBeVisible();
  return persisted;
}

test("public session links expose all seven participation states through accessible mobile My agenda controls", async ({
  page: staff,
  browser,
}, info) => {
  test.setTimeout(480_000);
  await signInAsE2eStaff(staff, e2eAdminEmail("default"));
  const fixture = await prepareParticipationStates(staff);
  const [reservation, approval, invitation, closed] = fixture.agenda.occurrences;
  if (!reservation || !approval || !invitation || !closed)
    throw new Error("The state journey requires four canonical sessions");
  const contexts = await Promise.all(
    [0, 1].map(() =>
      browser.newContext({ baseURL: new URL(staff.url()).origin, viewport: { width: 390, height: 844 } }),
    ),
  );
  const evidence: unknown[] = [];
  try {
    const first = await contexts[0]!.newPage();
    const second = await contexts[1]!.newPage();
    for (const [index, attendee] of [first, second].entries()) {
      const email = ownDomainEmail(`state-attendee-${index}`);
      await registerStateAttendee(attendee, fixture, email, { organization: `State attendee ${index} org` });
      await signInToPortal(attendee, email);
    }

    await followPublic(first, fixture, reservation, "Reserve a seat");
    await expect(admissionNote(first, "reservation")).toBeVisible();
    const reserved = await submit(first, fixture, reservation, "reserve", "Reserve a seat");
    expect(reserved.receipt.status).toBe("reserved");
    evidence.push({
      label: "Reserved",
      operation: reserved,
      personal: await inspectState(first, fixture, reservation, "Reserved", "reserved", info),
    });

    await followPublic(second, fixture, reservation, "Reserve a seat");
    const full = await readSession(second, fixture, reservation);
    expect(full.availability).toMatchObject({ attendanceMode: "physical", state: "full", bookingAction: "reserve" });
    evidence.push({
      label: "Full",
      personal: await inspectState(second, fixture, reservation, "Join the waiting list", null, info),
    });
    const waiting = await submit(second, fixture, reservation, "reserve", "Join the waiting list");
    expect(waiting.receipt.status).toBe("waitlisted");
    evidence.push({
      label: "Waitlisted",
      operation: waiting,
      personal: await inspectState(second, fixture, reservation, "On the waiting list", "waitlisted", info),
    });

    await followPublic(second, fixture, approval, "Request a seat");
    await expect(admissionNote(second, "approval")).toBeVisible();
    const pending = await submit(second, fixture, approval, "request", "Request a seat");
    expect(pending.receipt.status).toBe("approval_pending");
    evidence.push({
      label: "Awaiting approval",
      operation: pending,
      personal: await inspectState(second, fixture, approval, "Awaiting approval", "approval_pending", info),
    });

    for (const [occurrence, label, publicLabel, state] of [
      [invitation, "By invitation only", "By invitation only", "invitation_required"],
      [closed, "Reservations are closed", "Reserve a seat", "closed"],
    ] as const) {
      const invitationOnly = state === "invitation_required";
      await followPublic(second, fixture, occurrence, publicLabel, { participates: !invitationOnly });
      const current = await readSession(second, fixture, occurrence);
      expect(current.availability).toMatchObject({ attendanceMode: "physical", state, bookingAction: null });
      const panel = participation(second);
      // Nothing can be booked, so no seat action is offered while the star stays available.
      await expect(panel.getByRole("button", { name: /seat|waiting list/ })).toHaveCount(0);
      await expect(
        second
          .getByRole("dialog", { name: occurrence.title, exact: true })
          .getByRole("button", { name: `Star ${occurrence.title}`, exact: true }),
      ).toBeEnabled();
      evidence.push({
        label,
        personal: await inspectState(second, fixture, occurrence, label, null, info, { stateInHeader: invitationOnly }),
      });
    }

    // Release only after the full/waitlisted evidence: normal waitlist promotion must not invalidate that earlier proof.
    await followPublic(first, fixture, reservation, "Reserve a seat");
    const canceled = await cancelRegistration(first, fixture, reservation);
    expect(canceled.receipt.status).toBe("canceled");
    evidence.push({
      label: "Canceled",
      operation: canceled,
      // A canceled seat can be reserved again; the session stays on My agenda while it is starred.
      personal: await inspectState(first, fixture, reservation, "Reserve a seat", "canceled", info, {
        rowLabel: "Canceled",
      }),
    });
    expect(evidence).toHaveLength(7);
    const receiptPath = info.outputPath("participation-states-receipt.json");
    await writeFile(
      receiptPath,
      JSON.stringify(
        {
          eventId: fixture.eventId,
          slug: fixture.slug,
          publicAgendaPath: fixture.agenda.publicAgendaPath,
          snapshotId: fixture.release.snapshotId,
          publishedRevision: fixture.agenda.publishedRevision,
          closedAt: fixture.closedAt,
          evidence,
          scope:
            "Synthetic current-policy Chromium desktop/390 journey; no physical-device or provider acceptance claim.",
        },
        null,
        2,
      ) + "\n",
    );
    await info.attach("participation-states-receipt", { path: receiptPath, contentType: "application/json" });
  } finally {
    for (const context of contexts) await context.close();
  }
});
