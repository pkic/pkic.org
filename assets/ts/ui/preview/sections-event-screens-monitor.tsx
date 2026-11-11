/**
 * Screen monitoring, as staff see it: the Screens tab with each screen's
 * live health, and the studio's Screens panel for one room. Live reports
 * come from synthetic fixtures on the gallery's fixed clock.
 */
import type { PreviewSection } from "./PreviewShell";
import type { ScreenHealth, ScreenLiveStatus } from "../../../shared/schemas/event-screen-monitor";
import type { ScreenRecord } from "../../../shared/schemas/event-screens";
import { EventScreens } from "../../member-flows/portal/sections/events/detail/screens/EventScreens";
import { ScreensPanel } from "../../member-flows/portal/sections/events/detail/live/studio/ScreensPanel";
import { StudioPanelFrame } from "../../member-flows/portal/sections/events/detail/live/studio/StudioPanelFrame";
import "../../member-flows/portal/sections/events/detail/live/studio/StudioGrid.css";
import { SCREEN_FIXTURE, SCREEN_FIXTURE_NOW } from "./event-screens-fixtures";
import { SCREENS, WorkspaceTabs, blue, fixturesWith, screen } from "./sections-event-screens-staff";

const at = (minutesAgo: number) => new Date(SCREEN_FIXTURE_NOW - minutesAgo * 60_000).toISOString();

const health = (overrides: Partial<ScreenHealth>): ScreenHealth => ({
  pageVersion: "screen-page-3f9a1c.js",
  display: "output",
  output: "projector",
  mode: "live",
  player: null,
  clockOffsetMs: 120,
  metrics: { uptime: 3 * 3600 + 12 * 60, temps: { cpu: 54.2, nvme: 41 } },
  ...overrides,
});

const online = (screenId: string, report: ScreenHealth): ScreenLiveStatus => ({
  screenId,
  online: true,
  connectedAt: at(190),
  disconnectedAt: null,
  reportedAt: at(0.2),
  health: report,
});

const LIVE: ReadonlyMap<string, ScreenLiveStatus> = new Map(
  [
    online(
      SCREEN_FIXTURE.screenId,
      health({
        display: "livestream",
        output: "livestream",
        player: { status: "playing", muted: true, changedAt: at(40), playback: null },
      }),
    ),
    online("Q4ZT7B", health({ output: "stage-display", mode: "auto", clockOffsetMs: 2400 })),
    online(
      "B5LN3D",
      health({
        output: "projector",
        metrics: { uptime: 26 * 3600, temps: { cpu: 61.8 } },
      }),
    ),
  ].map((status) => [status.screenId, status]),
);

const BLUE_PROJECTOR = screen(
  "B5LN3D",
  "Blue room, projector",
  { ...blue, output: "projector" },
  { state: "active", seenMinutesAgo: 1 },
);
const TAB_SCREENS: ScreenRecord[] = [SCREENS[0]!, SCREENS[1]!, BLUE_PROJECTOR, ...SCREENS.slice(2)];
const ROOM_SCREENS = TAB_SCREENS.filter((each) => each.assignment?.roomId === blue.roomId);
const noCommand = () => undefined;

function MonitoredTab({ canManage }: { canManage: boolean }) {
  return (
    <div class="pk-stack">
      <WorkspaceTabs />
      <EventScreens
        slug="pqc-conference-2026"
        canManage={canManage}
        now={SCREEN_FIXTURE_NOW}
        load={fixturesWith(TAB_SCREENS)}
        live={LIVE}
        onCommand={canManage ? noCommand : undefined}
      />
    </div>
  );
}

const noHandlers = {
  onPointerDown: noCommand,
  onPointerMove: noCommand,
  onPointerUp: noCommand,
  onPointerCancel: noCommand,
  onLostPointerCapture: noCommand,
};

/** The panel in a studio grid cell, the size an operator would open it at. */
function StudioScreens({ canManage }: { canManage: boolean }) {
  const panel = {
    id: "screens-1",
    type: "time" as const,
    x: 0,
    y: 0,
    w: 5,
    h: 9,
  };
  return (
    <div class="pk-studio-grid-frame" data-density="compact">
      <div class="pk-studio-grid">
        <StudioPanelFrame
          panel={panel}
          panels={[panel]}
          title="Screens"
          change={noCommand}
          defaultSize={{ w: 5, h: 9 }}
          cell={noCommand}
          dragHandle={noHandlers}
          resizeHandle={() => noHandlers}
        >
          <ScreensPanel
            screens={ROOM_SCREENS}
            live={LIVE}
            now={SCREEN_FIXTURE_NOW}
            onCommand={canManage ? noCommand : undefined}
          />
        </StudioPanelFrame>
      </div>
    </div>
  );
}

export const eventScreenMonitorSections: PreviewSection[] = [
  {
    id: "screens-tab-monitor",
    title: "Screens tab, live health",
    note: "Under what each screen is assigned: a fault or fallback in tone, then its device metrics. Identify and Reload sit in the row menu.",
    render: () => <MonitoredTab canManage />,
  },
  {
    id: "screens-tab-monitor-read-only",
    title: "Screens tab, live health, read-only",
    note: "A room operator sees the same health without row actions.",
    render: () => <MonitoredTab canManage={false} />,
  },
  {
    id: "studio-screens-panel",
    title: "Studio Screens panel",
    note: "The room's screens in one compact list: connection, what each draws, device metrics. Managers get Identify and Reload in each row's menu.",
    render: () => <StudioScreens canManage />,
  },
  {
    id: "studio-screens-panel-read-only",
    title: "Studio Screens panel, read-only",
    note: "Operators without screen management watch only.",
    render: () => <StudioScreens canManage={false} />,
  },
];
