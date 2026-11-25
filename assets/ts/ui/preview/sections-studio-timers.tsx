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
import { LiveTimerDialog } from "../../member-flows/portal/sections/events/detail/live/studio/LiveTimerDialog";
import { defaultLiveTimerGraphic } from "../../../shared/schemas/live-session-timer";
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

function TimeSpecimen({ state = panelState }: { state?: LiveRoomState }) {
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
              state={state}
              clock={state.session.timeZone}
              send={send}
              disabled={false}
              next={null}
              targets={{ state, programActive: true, disabled: false, sendProgram: send }}
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

/** Program with these timer graphics in the layout's corner, over a picture as on the stream. */
function ProgramTimers({ state, layout }: { state: LiveRoomState; layout?: string }) {
  return (
    <Fixed>
      <div class="pk-preview__screen pk-preview__camera">
        <LiveOverlayPresentation view="program" layout={layout} projection={state} />
      </div>
    </Fixed>
  );
}

const programTimers = timersRoomState([pitchTimer, lunchTimer, overrunPitchTimer], [], {
  stage: {
    ...timersRoomState([]).stage,
    timerGraphics: [
      { ...defaultLiveTimerGraphic(pitchTimer.id), warningSeconds: 30 },
      { ...defaultLiveTimerGraphic(lunchTimer.id), presentation: "digital" },
      defaultLiveTimerGraphic(overrunPitchTimer.id),
    ],
  },
});

const programMark = timersRoomState([pitchTimer], [], {
  stage: {
    ...timersRoomState([]).stage,
    timerGraphics: [{ ...defaultLiveTimerGraphic(pitchTimer.id), presentation: "ring", warningSeconds: 30 }],
  },
});

/** A break timer in its own top-right corner over the Q&A column, with a long audience question on air. */
const questionColumnTimer = timersRoomState([breakTimer], [], {
  stage: {
    ...timersRoomState([]).stage,
    question: {
      id: "question-long",
      text: "How long should a certificate issued for a conference be valid, and who should be able to revoke it once the event is over?",
      authorName: null,
      authorPhotoUrl: null,
      authorAffiliation: null,
      addressedTo: null,
    },
    timerGraphics: [{ ...defaultLiveTimerGraphic(breakTimer.id), placement: "top-right" }],
  },
});

export const studioTimerSections: PreviewSection[] = [
  {
    id: "program-timer-mark",
    title: "Program: a timer as the mark",
    note: "A pitch in the emblem: its seats fill in the event's colors as the time goes, clipped to the seats at any size.",
    render: () => <ProgramTimers state={programMark} />,
  },
  {
    id: "program-timers",
    title: "Program: timers in the corner",
    note: "Each timer on a plate in the event's colors, stacked down the top-right corner at full size: a pitch in its warning with the ring of time left, a countdown to lunch without a ring, and a pitch over time.",
    render: () => <ProgramTimers state={programTimers} />,
  },
  {
    id: "program-timer-question-column",
    title: "Program: a timer over the Q&A column",
    note: "A timer in its own top-right corner over the column beside the camera: the eyebrow starts under it, and the question keeps the column's full width.",
    render: () => <ProgramTimers state={questionColumnTimer} layout="questions" />,
  },
  {
    id: "studio-time-panel",
    title: "Studio: Time panel",
    note: "One row per timer: value and progress, PVW and PGM first, then Start, Reset and a minute either way; the menu holds every action. The session timer waits on the agenda with no controls.",
    render: () => <TimeSpecimen />,
  },
  {
    id: "studio-time-panel-session-running",
    title: "Studio: session timer during its session",
    note: "On the agenda the session timer runs by itself: its row offers only a minute either way.",
    render: () => <TimeSpecimen state={stageClockState} />,
  },
  {
    id: "studio-timer-settings",
    title: "Studio: timer settings",
    note: "One dialog from the row's menu: name and length, the warning with its chime and buzzer, where they play, what happens at zero, and the look.",
    render: () => (
      <div data-density="compact">
        <LiveTimerDialog
          timer={pitchTimer}
          clock="Europe/Amsterdam"
          graphic={defaultLiveTimerGraphic(pitchTimer.id)}
          send={send}
          saveGraphic={() => true}
          onClose={() => undefined}
        />
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
