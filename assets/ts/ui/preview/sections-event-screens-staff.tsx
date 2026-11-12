/**
 * The event workspace's Screens tab: the list and its room choices read
 * from synthetic fixtures on a fixed clock, the pairing dialog opened from
 * its toolbar, and the replace device dialog opened from a screen's menu.
 */
import type { ComponentChildren } from "preact";
import type { PreviewSection } from "./PreviewShell";
import { Tabs } from "../../components/Tabs";
import type { CollectionLoader } from "../../hooks/useServerCollection";
import { eventScreensListSchema, type ScreenRecord } from "../../../shared/schemas/event-screens";
import { agendaRoomsListSchema } from "../../../shared/schemas/event-agenda-room-list";
import { EventScreens } from "../../member-flows/portal/sections/events/detail/screens/EventScreens";
import { ScreenPairDialog } from "../../member-flows/portal/sections/events/detail/screens/ScreenPairDialog";
import { ScreenReplaceDialog } from "../../member-flows/portal/sections/events/detail/screens/ScreenReplaceDialog";
import { useState } from "preact/hooks";
import { Button } from "../Button";
import { SCREEN_FIXTURE, SCREEN_FIXTURE_NOW } from "./event-screens-fixtures";

const GREEN_ROOM_ID = "30000000-0000-4000-8000-000000000002";
const ROOMS = agendaRoomsListSchema.parse({
  rooms: [
    { id: SCREEN_FIXTURE.roomId, name: SCREEN_FIXTURE.roomName, capacity: 240 },
    { id: GREEN_ROOM_ID, name: "Green room", capacity: 80 },
  ],
  page: { limit: 25, offset: 0, total: 2, hasMore: false },
});

const minutesBefore = (minutes: number) => new Date(SCREEN_FIXTURE_NOW - minutes * 60_000).toISOString();

/** A screen record of the fixture event, last seen this many minutes before the fixed clock. */
export function screen(
  id: string,
  name: string,
  assignment: { roomId: string; roomName: string; output: NonNullable<ScreenRecord["assignment"]>["output"] } | null,
  session: { state: ScreenRecord["session"]["state"]; seenMinutesAgo?: number },
): ScreenRecord {
  const seen = session.seenMinutesAgo === undefined ? null : minutesBefore(session.seenMinutesAgo);
  return {
    id,
    name,
    eventId: "20000000-0000-4000-8000-000000000001",
    assignment: assignment && { ...assignment, layout: null, assignedAt: minutesBefore(600) },
    revision: 1,
    session: {
      state: session.state,
      activatedAt: session.state === "active" ? minutesBefore(600) : null,
      lastSeenAt: seen,
      expiresAt: session.state === "none" ? null : minutesBefore(-60 * 24 * 300),
    },
    createdAt: minutesBefore(1440),
  };
}

export const blue = { roomId: SCREEN_FIXTURE.roomId, roomName: SCREEN_FIXTURE.roomName };
export const green = { roomId: GREEN_ROOM_ID, roomName: "Green room" };
export const SCREENS: ScreenRecord[] = [
  screen(
    SCREEN_FIXTURE.screenId,
    SCREEN_FIXTURE.name,
    { ...blue, output: "livestream" },
    {
      state: "active",
      seenMinutesAgo: 4,
    },
  ),
  screen(
    "Q4ZT7B",
    "Blue room, stage monitor",
    { ...blue, output: "stage-display" },
    { state: "active", seenMinutesAgo: 2 },
  ),
  screen("M3XW5C", "Green room, back wall", { ...green, output: "projector" }, { state: "active", seenMinutesAgo: 12 }),
  screen("P6RD2K", "Coffee area, east", null, { state: "pending" }),
  screen("T2HN6V", "Spare, storage room", null, { state: "none" }),
];

/** Answers the tab's two reads, the screens (only those asked for by ID, when it asks) and the room choices. */
export const fixturesWith =
  (screens: ScreenRecord[]): CollectionLoader =>
  async (url, _signal, schema) => {
    if (url.includes("/agenda/rooms")) return schema.parse(ROOMS);
    const ids = new URL(url, "https://gallery.invalid").searchParams.get("screenIds")?.split(",");
    const listed = ids ? screens.filter((screen) => ids.includes(screen.id)) : screens;
    return schema.parse(
      eventScreensListSchema.parse({
        screens: listed,
        page: { limit: 25, offset: 0, total: listed.length, hasMore: false },
      }),
    );
  };

/** The workspace strip around the tab, so the specimen shows where Screens sits. */
export function WorkspaceTabs() {
  return (
    <Tabs
      items={[
        { key: "overview", label: "Overview" },
        { key: "agenda", label: "Agenda" },
        { key: "live", label: "Studio" },
        { key: "screens", label: "Screens" },
        { key: "settings", label: "Settings" },
      ]}
      active="screens"
      onChange={() => undefined}
      label="Event workspace"
    />
  );
}

function ScreensTab({ screens, canManage = true }: { screens: ScreenRecord[]; canManage?: boolean }) {
  return (
    <div class="pk-stack">
      <WorkspaceTabs />
      <EventScreens
        slug="pqc-conference-2026"
        canManage={canManage}
        now={SCREEN_FIXTURE_NOW}
        load={fixturesWith(screens)}
      />
    </div>
  );
}

/** A dialog behind the button that opens it, which the gallery clicks for its screenshot. */
function DialogSpecimen({ label, dialog }: { label: string; dialog: (close: () => void) => ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-gallery-open>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && dialog(() => setOpen(false))}
    </div>
  );
}

export const eventScreenStaffSections: PreviewSection[] = [
  {
    id: "screens-tab",
    title: "Screens tab",
    note: "Every screen of the event: where it stands, what it shows, and whether it is online.",
    render: () => <ScreensTab screens={SCREENS} />,
  },
  {
    id: "screens-tab-read-only",
    title: "Screens tab, read-only",
    note: "A room operator without screen management sees the list without Pair screen or row actions.",
    render: () => <ScreensTab screens={SCREENS} canManage={false} />,
  },
  {
    id: "screens-tab-empty",
    title: "Screens tab, no screens",
    note: "Pair screen in the toolbar is the way in; the empty state says what to enter.",
    render: () => <ScreensTab screens={[]} />,
  },
  {
    id: "screens-pair-dialog",
    title: "Pair screen",
    note: "Staff copy the pairing code and screen ID off the screen; the assignment can wait.",
    render: () => (
      <DialogSpecimen
        label="Pair screen"
        dialog={(close) => (
          <ScreenPairDialog
            open
            slug="pqc-conference-2026"
            load={fixturesWith([])}
            onPaired={() => undefined}
            onClose={close}
          />
        )}
      />
    ),
  },
  {
    id: "screens-replace-dialog",
    title: "Replace device",
    note: "From a screen's menu: staff enter what the new device shows, and the screen keeps its name and assignment there. While the current device is online, the dialog says it stops showing the screen.",
    render: () => (
      <DialogSpecimen
        label="Replace device…"
        dialog={(close) => (
          <ScreenReplaceDialog
            screen={SCREENS[0]!}
            online
            onReplaced={() => undefined}
            onChanged={() => undefined}
            onClose={close}
          />
        )}
      />
    ),
  },
];
