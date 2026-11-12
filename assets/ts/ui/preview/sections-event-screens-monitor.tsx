/**
 * Screen monitoring, as staff see it: the Screens tab's multi-view of every
 * screen with its latest screenshot and last hour, and the studio's Screens
 * panel for one room. Everything comes from synthetic fixtures on the
 * gallery's fixed clock.
 */
import type { PreviewSection } from "./PreviewShell";
import type { ScreenRecord } from "../../../shared/schemas/event-screens";
import { EventScreens } from "../../member-flows/portal/sections/events/detail/screens/EventScreens";
import { screenMonitorIssues } from "../../member-flows/portal/sections/events/detail/screens/screen-monitor-view";
import { ScreensPanel } from "../../member-flows/portal/sections/events/detail/live/studio/ScreensPanel";
import { StudioPanelFrame } from "../../member-flows/portal/sections/events/detail/live/studio/StudioPanelFrame";
import "../../member-flows/portal/sections/events/detail/live/studio/StudioGrid.css";
import { SCREEN_FIXTURE_NOW } from "./event-screens-fixtures";
import { MONITOR, MONITOR_SCREENS } from "./event-screens-monitor-fixtures";
import { SCREENS, WorkspaceTabs, blue, fixturesWith, screen } from "./sections-event-screens-staff";

const BLUE_PROJECTOR = screen(
  MONITOR_SCREENS.projector,
  "Blue room, projector",
  { ...blue, output: "projector" },
  { state: "active", seenMinutesAgo: 1 },
);
const BLUE_LAPTOP = screen(
  MONITOR_SCREENS.laptop,
  "Blue room, laptop at the lectern",
  { ...blue, output: "stage-display" },
  { state: "active", seenMinutesAgo: 1 },
);
const TAB_SCREENS: ScreenRecord[] = [SCREENS[0]!, SCREENS[1]!, BLUE_PROJECTOR, BLUE_LAPTOP, ...SCREENS.slice(2)];
/** A screen whose device was reinstalled under a new screen ID: the old record, unseen since. */
const LEFT_BEHIND = screen(
  "H6WQ3R",
  "Main hall, left of stage",
  { ...blue, output: "projector" },
  {
    state: "active",
    seenMinutesAgo: 17,
  },
);
const ROOM_SCREENS = TAB_SCREENS.filter((each) => each.assignment?.roomId === blue.roomId);
const noCommand = () => undefined;
const ISSUES = screenMonitorIssues(MONITOR, SCREEN_FIXTURE_NOW);

function MonitoredTab({ canManage, screens = TAB_SCREENS }: { canManage: boolean; screens?: ScreenRecord[] }) {
  return (
    <div class="pk-stack">
      <WorkspaceTabs />
      <EventScreens
        slug="pqc-conference-2026"
        canManage={canManage}
        now={SCREEN_FIXTURE_NOW}
        load={fixturesWith(screens)}
        monitor={{ view: MONITOR, now: SCREEN_FIXTURE_NOW, control: canManage }}
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
    h: 12,
  };
  return (
    <div class="pk-studio-grid-frame" data-density="compact">
      <div class="pk-studio-grid">
        <StudioPanelFrame
          panel={panel}
          panels={[panel]}
          title="Screens"
          menu={[
            { id: "notify", label: "Notify me in this browser", checked: false, multiple: true, onSelect: noCommand },
          ]}
          change={noCommand}
          defaultSize={{ w: 5, h: 12 }}
          cell={noCommand}
          dragHandle={noHandlers}
          resizeHandle={() => noHandlers}
        >
          <ScreensPanel
            screens={ROOM_SCREENS}
            monitor={MONITOR}
            issuesOf={(screenId) => ISSUES.get(screenId) ?? []}
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
    title: "Screens tab, multi-view",
    note: "One card per screen, those with critical issues first, then warnings, their tone along the top edge: latest screenshot with its age, name, room and output, one condition line, then the last hour of latency and loss, with throughput and stalls for livestream screens. The summary chip filters to the screens that need attention; the menu beside it turns on browser notifications.",
    render: () => <MonitoredTab canManage />,
  },
  {
    id: "screens-tab-monitor-read-only",
    title: "Screens tab, multi-view, read-only",
    note: "A room operator sees the same cards without a menu.",
    render: () => <MonitoredTab canManage={false} />,
  },
  {
    id: "screens-tab-offline",
    title: "Screens tab, offline screens",
    note: "A screen that shows nothing now reads as inactive: a sunk card, a grey picture area and secondary text. The status line keeps full ink and the menu works as usual. Online screens look as before.",
    render: () => <MonitoredTab canManage screens={[BLUE_PROJECTOR, SCREENS[2]!, LEFT_BEHIND]} />,
  },
  {
    id: "studio-screens-panel",
    title: "Studio Screens panel",
    note: "The room's screens as compact rows, worst first with their tone along the start: screenshot, name, output, one condition line, then latency with loss, or stalls for a livestream. Managers get Identify and Reload in each row's menu.",
    render: () => <StudioScreens canManage />,
  },
  {
    id: "studio-screens-panel-read-only",
    title: "Studio Screens panel, read-only",
    note: "Operators without screen management watch only.",
    render: () => <StudioScreens canManage={false} />,
  },
];
