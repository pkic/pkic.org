/**
 * The studio's Time panel and the stage display's timers, drawn through
 * their own components on a fixed clock: a session timer that follows the
 * agenda before its session starts, timers of hours, days and years, and a
 * pitch over time.
 */
import type { ComponentChildren } from "preact";
import type { PreviewSection } from "./PreviewShell";
import { LiveClockContext } from "../../live-session/useLiveCountdown";
import type { LiveRoomState } from "../../live-session/live-room-state";
import { LiveOverlayPresentation } from "../../live-session/LiveOverlayPresentation";
import { TimePanel } from "../../member-flows/portal/sections/events/detail/live/studio/TimePanel";
import { LiveTimerSettingsDialog } from "../../member-flows/portal/sections/events/detail/live/studio/LiveTimerSettingsDialog";
import { Panel } from "../Panel";
import { SectionHeading } from "../SectionHeading";
import {
  TIMERS_FIXTURE_NOW,
  agendaSessionTimer,
  breakTimer,
  clockTimer,
  doorsTimer,
  lunchTimer,
  overrunPitchTimer,
  pitchTimer,
  qDayTimer,
  stageClockState,
  stageDisplayWith,
  timersRoomState,
} from "./studio-timers-fixtures";
import "../../../design/fonts-mono.css";
import "../../member-flows/portal/sections/events/detail/live/studio/StudioGrid.css";
import "./event-screens-preview.css";

const fixedClock = () => TIMERS_FIXTURE_NOW;
const send = () => true;
const panelState = timersRoomState([agendaSessionTimer, pitchTimer, lunchTimer, qDayTimer, breakTimer, clockTimer]);

function Fixed({ children }: { children: ComponentChildren }) {
  return <LiveClockContext.Provider value={fixedClock}>{children}</LiveClockContext.Provider>;
}

function TimeSpecimen() {
  return (
    <Fixed>
      <div data-density="compact">
        <Panel class="pk-studio-panel" aria-label="Time">
          <header class="pk-studio-panel__header">
            <SectionHeading level={3} class="pk-studio-panel__title">
              Time
            </SectionHeading>
          </header>
          <div class="pk-studio-panel__body">
            <TimePanel
              state={panelState}
              clock={panelState.session.timeZone}
              send={send}
              disabled={false}
              next={null}
              targets={{ state: panelState, programActive: true, disabled: false, sendProgram: send }}
            />
          </div>
        </Panel>
      </div>
    </Fixed>
  );
}

function StageDisplay({ state }: { state: LiveRoomState }) {
  return (
    <Fixed>
      <div class="pk-preview__screen">
        <LiveOverlayPresentation view="stage-display" projection={state} />
      </div>
    </Fixed>
  );
}

export const studioTimerSections: PreviewSection[] = [
  {
    id: "studio-time-panel",
    title: "Studio: Time panel",
    note: "One row per timer: value and progress, PVW and PGM first, then Start, Reset and a minute either way; the menu holds every action.",
    render: () => <TimeSpecimen />,
  },
  {
    id: "studio-timer-settings",
    title: "Studio: timer settings",
    note: "What a timer does at zero and where its sounds play, from the row's menu.",
    render: () => (
      <div data-density="compact">
        <LiveTimerSettingsDialog timer={pitchTimer} send={send} onClose={() => undefined} />
      </div>
    ),
  },
  {
    id: "stage-timer-before-start",
    title: "Stage display: session before it starts",
    note: "Following the agenda, the session timer reads the time until its session starts.",
    render: () => <StageDisplay state={stageDisplayWith(agendaSessionTimer)} />,
  },
  {
    id: "stage-timer-hours",
    title: "Stage display: hours",
    render: () => <StageDisplay state={stageDisplayWith(lunchTimer)} />,
  },
  {
    id: "stage-timer-days",
    title: "Stage display: days",
    render: () => <StageDisplay state={stageDisplayWith(doorsTimer)} />,
  },
  {
    id: "stage-timer-clock",
    title: "Stage display: clock with timers",
    note: "The event's time of day in the top line, beside the session timer, a pitch and the operators' message.",
    render: () => <StageDisplay state={stageClockState} />,
  },
  {
    id: "stage-timer-overrun",
    title: "Stage display: pitch over time",
    render: () => <StageDisplay state={stageDisplayWith(overrunPitchTimer)} />,
  },
];
