/**
 * One event running today, for walking the event app and its management
 * screens in the state they are designed for: a location streaming, a session
 * live in it now, and the signed-in operator registered as an attendee.
 */
import { expect, type Page } from "@playwright/test";
import { eventDetailResponseSchema } from "../../../assets/shared/schemas/event-management";
import {
  agendaOccurrenceCreateSchema,
  agendaRevisionSchema,
  agendaRoomCreateSchema,
  agendaSnapshotSchema,
} from "../../../assets/shared/schemas/event-agenda";
import { locationLiveStreamUpdateSchema } from "../../../assets/shared/schemas/event-live-stream";
import { liveOverlayAccessResponseSchema } from "../../../assets/shared/schemas/live-session-room";
import { organizationsListResponseSchema } from "../../../assets/shared/schemas/organization-management";
import { usersListResponseSchema } from "../../../assets/shared/schemas/user-management";
import { liveOverlayAddress } from "../../../assets/ts/live-session/live-overlay-address";
import { runRowAction } from "./data-table";
import { createRegistrationEvent, registerStateAttendee } from "./participation-state-fixture";

const FIVE_MINUTES = 300_000;

/** A session window that contains now and stays inside today's UTC day. */
function liveWindow(now: number): { startAt: string; endAt: string } {
  const dayStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const start = Math.max(dayStart, Math.floor((now - 30 * 60_000) / FIVE_MINUTES) * FIVE_MINUTES);
  const end = Math.min(dayStart + 86_400_000 - FIVE_MINUTES, start + 2 * 3_600_000);
  return { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() };
}

export async function prepareEventAppScreens(staff: Page, email: string) {
  const today = new Date().toISOString().slice(0, 10);
  const fixture = await createRegistrationEvent(staff, "event-app-screens", {
    date: today,
    startTime: "00:00",
    endTime: "23:55",
  });
  const base = `/api/v1/events/${fixture.slug}/agenda`;
  let agenda = agendaSnapshotSchema.parse(await (await staff.request.get(base)).json());
  for (const name of ["Main hall", "Workshop room"]) {
    const room = await staff.request.post(`${base}/rooms`, {
      data: agendaRoomCreateSchema.parse({ expectedRevision: agenda.revision, name, capacity: 120 }),
    });
    expect(room.status(), await room.text()).toBe(200);
    agenda = agendaSnapshotSchema.parse(await room.json());
  }
  const hall = agenda.rooms[0]!;
  const stream = await staff.request.put(`${base}/rooms/${encodeURIComponent(hall.id)}/stream`, {
    data: locationLiveStreamUpdateSchema.parse({ videoId: "dQw4w9WgXcQ", days: [] }),
  });
  expect(stream.status(), await stream.text()).toBe(200);
  const occurrence = await staff.request.post(`${base}/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: agenda.revision,
      title: "Synthetic opening keynote on certificate lifecycles",
      description: "A synthetic keynote that is live while the responsive sweep walks the event app.",
      ...liveWindow(Date.now()),
      roomId: hall.id,
      admissionPolicy: "reservation",
      accessPolicy: "open",
      capacity: 120,
      bookingClosesAt: null,
      speakerUserIds: [],
    }),
  });
  expect(occurrence.status(), await occurrence.text()).toBe(200);
  agenda = agendaSnapshotSchema.parse(await occurrence.json());
  const published = await staff.request.post(`${base}/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: agenda.revision }),
  });
  expect(published.status(), await published.text()).toBe(200);

  await registerStateAttendee(staff, fixture, email, { staticRelease: false });

  const detail = await staff.request.get(`/api/v1/events/${encodeURIComponent(fixture.slug)}`);
  expect(detail.status()).toBe(200);
  const event = eventDetailResponseSchema.parse(await detail.json()).event;
  if (!("ownerGroupId" in event) || !event.ownerGroupId) throw new Error("Fixture event has no group workspace");
  const registrationId = "participation" in event ? event.participation?.registrationId : null;

  const organizations = await staff.request.get("/api/v1/organizations?limit=1");
  expect(organizations.status()).toBe(200);
  const organization = organizationsListResponseSchema.parse(await organizations.json()).organizations[0];

  const occurrenceId = agenda.occurrences[0]!.id;
  const active = await staff.request.post(`${base}/rooms/${encodeURIComponent(hall.id)}/live/program`, {
    data: { occurrenceId, expectedRevision: 0 },
  });
  expect(active.status(), await active.text()).toBe(200);
  const overlay = await staff.request.post(`${base}/rooms/${encodeURIComponent(hall.id)}/live/overlays`);
  expect(overlay.status(), await overlay.text()).toBe(201);
  const overlayToken = liveOverlayAccessResponseSchema.parse(await overlay.json()).token;

  // The operator's own record, whose administration holds the account's email addresses.
  const users = await staff.request.get(`/api/v1/users?q=${encodeURIComponent(email)}&limit=1`);
  expect(users.status(), await users.text()).toBe(200);
  const userId = usersListResponseSchema.parse(await users.json()).users[0]!.id;

  return {
    slug: fixture.slug,
    userId,
    overlayToken,
    roomId: hall.id,
    workspace: `/groups/${encodeURIComponent(event.ownerGroupId)}/events/${encodeURIComponent(event.id)}`,
    registrationId: registrationId ?? null,
    occurrenceId,
    organizationId: organization?.id ?? null,
  };
}

/** The size every broadcast overlay is added to a streaming tool at. */
const BROADCAST = { width: 1920, height: 1080 };

/** A screen reached by its address, then optionally by the control a reader would use next. */
export interface EventScreen {
  name: string;
  /** Site-relative: a portal hash route under `/portal/`, or a page of its own. */
  path: string;
  open?: (page: Page) => Promise<void>;
  /** A broadcast browser source has one fixed canvas; it is walked at that size only. */
  canvas?: { width: number; height: number };
}

/**
 * Waits for a screen's data rather than its network: a lazy section starts
 * its request after the chunk loads, so the network can fall idle while the
 * screen still shows its spinner. An event live today keeps polling its room,
 * so the network may never fall idle at all; that wait is only a head start.
 */
export async function settleScreen(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await expect(page.locator(".pk-spinner")).toHaveCount(0, { timeout: 20_000 });
}

function selectTab(label: string) {
  return async (page: Page) => {
    await page.getByRole("tab", { name: label, exact: true }).click({ timeout: 15_000 });
    await settleScreen(page);
  };
}

function press(label: string, then?: (page: Page) => Promise<void>) {
  return async (page: Page) => {
    await page.getByRole("button", { name: label, exact: true }).click({ timeout: 15_000 });
    await settleScreen(page);
    await then?.(page);
  };
}

/**
 * A planner toolbar command. Below the container width where the toolbar compacts, its editor
 * controls live in the "Agenda filters and actions" menu instead of beside the search.
 */
function pressAgendaAction(label: string) {
  return async (page: Page) => {
    const button = page.getByRole("button", { name: label, exact: true });
    if (await button.isVisible()) await button.click({ timeout: 15_000 });
    else {
      await page.getByRole("button", { name: "Agenda filters and actions", exact: true }).click({ timeout: 15_000 });
      await page.getByRole("menuitemradio", { name: label, exact: true }).click({ timeout: 15_000 });
    }
    await settleScreen(page);
  };
}

async function openPromotionKit(page: Page): Promise<void> {
  await selectTab("Schedule")(page);
  const row = page.getByRole("table", { name: "Event sessions", exact: true }).getByRole("row").nth(1);
  await runRowAction(page, row, "Speaker promotion kit");
  await settleScreen(page);
}

/**
 * The event app and its management, on the event live today: the participant's
 * own screens, then the organizer's planning, scanning and control room, the
 * broadcast overlays, and the identity screens an event's registrations feed.
 */
export function eventScreens(fixture: Awaited<ReturnType<typeof prepareEventAppScreens>>): EventScreen[] {
  const app = `/portal/#/events/${encodeURIComponent(fixture.slug)}`;
  const workspace = `/portal/#${fixture.workspace}`;
  const session = encodeURIComponent(fixture.occurrenceId);
  const overlay = (view: "program" | "stage-display", layout = "full-frame") => {
    const url = new URL(
      liveOverlayAddress("http://overlay.invalid", {
        view,
        layout,
        slug: fixture.slug,
        roomId: fixture.roomId,
        token: fixture.overlayToken,
      }),
    );
    return url.pathname + url.search + url.hash;
  };
  return [
    { name: "event-home", path: app },
    { name: "event-agenda", path: `${app}/agenda` },
    { name: "event-session", path: `${app}/agenda?session=${session}` },
    { name: "event-my-agenda", path: `${app}/agenda?mine=1` },
    { name: "event-ticket", path: `${app}/ticket` },
    { name: "event-more", path: `${app}/more` },
    { name: "event-virtual-room", path: `${app}/virtual` },
    { name: "event-live-questions", path: `${app}/virtual`, open: selectTab("Questions") },
    ...(fixture.registrationId
      ? [{ name: "event-registration", path: `${app}/registrations/${encodeURIComponent(fixture.registrationId)}` }]
      : []),
    { name: "manage-overview", path: workspace },
    { name: "manage-registrations", path: `${workspace}/registrations` },
    { name: "manage-badge-issuance", path: `${workspace}/registrations/badges/new` },
    { name: "manage-agenda", path: `${workspace}/agenda` },
    { name: "manage-agenda-sources", path: `${workspace}/agenda`, open: pressAgendaAction("Show session sources") },
    { name: "manage-agenda-schedule", path: `${workspace}/agenda`, open: selectTab("Schedule") },
    { name: "manage-promotion-kit", path: `${workspace}/agenda`, open: openPromotionKit },
    { name: "manage-agenda-locations", path: `${workspace}/agenda`, open: selectTab("Locations") },
    { name: "manage-agenda-shifts", path: `${workspace}/agenda`, open: selectTab("Shifts") },
    { name: "manage-scanner", path: `${workspace}/scanner` },
    { name: "manage-fast-scanner", path: `${workspace}/scanner`, open: press("Start scanning") },
    {
      name: "manage-fast-scanner-controls",
      path: `${workspace}/scanner`,
      open: press("Start scanning", press("Operator controls")),
    },
    { name: "manage-control-room", path: `${workspace}/live` },
    { name: "manage-control-room-session", path: `${workspace}/live/${session}` },
    { name: "manage-settings", path: `${workspace}/settings` },
    { name: "overlay-program", path: overlay("program"), canvas: BROADCAST },
    { name: "overlay-lower-third", path: overlay("program", "lower-third"), canvas: BROADCAST },
    { name: "overlay-stage-display", path: overlay("stage-display"), canvas: BROADCAST },
    {
      name: "account-email",
      path: `/portal/#/users/${encodeURIComponent(fixture.userId)}`,
    },
    { name: "affiliation-reviews", path: "/portal/#/settings/affiliation-reviews" },
    ...(fixture.organizationId
      ? [
          {
            name: "organization-merge",
            path: `/portal/#/organizations/${encodeURIComponent(fixture.organizationId)}/merge`,
          },
        ]
      : []),
  ];
}
