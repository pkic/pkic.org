/**
 * The event workspace's Screens tab, as staff who manage screens see it:
 * the list read from a fixed page of synthetic screens on a fixed clock, and
 * the pairing dialog opened from its toolbar.
 */
import type { PreviewSection } from "./PreviewShell";
import { Tabs } from "../../components/Tabs";
import type { CollectionLoader } from "../../hooks/useServerCollection";
import { eventScreensListSchema, type ScreenRecord } from "../../../shared/schemas/event-screens";
import {
  EventScreens,
  type EventScreenCommands,
} from "../../member-flows/portal/sections/events/detail/screens/EventScreens";
import { ScreenPairDialog } from "../../member-flows/portal/sections/events/detail/screens/ScreenPairDialog";
import { useState } from "preact/hooks";
import { Button } from "../Button";
import { SCREEN_FIXTURE, SCREEN_FIXTURE_NOW } from "./event-screens-fixtures";

const GREEN_ROOM_ID = "30000000-0000-4000-8000-000000000002";
const ROOMS = [
  { id: SCREEN_FIXTURE.roomId, name: SCREEN_FIXTURE.roomName },
  { id: GREEN_ROOM_ID, name: "Green room" },
];
const LAYOUTS = [
  { slug: "full-frame", name: "Full frame" },
  { slug: "lower-third", name: "Lower third" },
  { slug: "panel", name: "Panel" },
];

const minutesBefore = (minutes: number) => new Date(SCREEN_FIXTURE_NOW - minutes * 60_000).toISOString();

function screen(
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

const blue = { roomId: SCREEN_FIXTURE.roomId, roomName: SCREEN_FIXTURE.roomName };
const green = { roomId: GREEN_ROOM_ID, roomName: "Green room" };
const SCREENS: ScreenRecord[] = [
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

const listOf =
  (screens: ScreenRecord[]): CollectionLoader =>
  async (_url, _signal, schema) =>
    schema.parse(
      eventScreensListSchema.parse({
        screens,
        page: { limit: 25, offset: 0, total: screens.length, hasMore: false },
      }),
    );

const commands: EventScreenCommands = {
  pair: async () => undefined,
  update: async () => undefined,
  revoke: async () => undefined,
};

/** The workspace strip around the tab, so the specimen shows where Screens sits. */
function WorkspaceTabs() {
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

function ScreensTab({ screens }: { screens: ScreenRecord[] }) {
  return (
    <div class="pk-stack">
      <WorkspaceTabs />
      <EventScreens
        slug="pqc-conference-2026"
        rooms={ROOMS}
        layouts={LAYOUTS}
        canManage
        commands={commands}
        now={SCREEN_FIXTURE_NOW}
        load={listOf(screens)}
      />
    </div>
  );
}

function PairDialogSpecimen() {
  const [open, setOpen] = useState(false);
  return (
    <div data-gallery-open>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Pair screen
      </Button>
      <ScreenPairDialog
        open={open}
        rooms={ROOMS}
        layouts={LAYOUTS}
        onPair={commands.pair}
        onClose={() => setOpen(false)}
      />
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
    id: "screens-tab-empty",
    title: "Screens tab, no screens",
    note: "Pair screen in the toolbar is the way in; the empty state says what to enter.",
    render: () => <ScreensTab screens={[]} />,
  },
  {
    id: "screens-pair-dialog",
    title: "Pair screen",
    note: "Staff copy the pairing code and screen ID off the screen; the assignment can wait.",
    render: () => <PairDialogSpecimen />,
  },
];
