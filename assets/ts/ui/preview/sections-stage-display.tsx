/**
 * The stage display in each state the speaker meets, drawn through the
 * overlay presentation on the timer specimens' fixed clock.
 */
import type { PreviewSection } from "./PreviewShell";
import type { LiveRoomState } from "../../live-session/live-room-state";
import { LiveOverlayPresentation } from "../../live-session/LiveOverlayPresentation";
import { LiveClockContext } from "../../live-session/useLiveCountdown";
import { TIMERS_FIXTURE_NOW } from "./studio-timers-fixtures";
import {
  stageBreakState,
  stageBeforeWithTimerState,
  stageOvertimeState,
  stagePollState,
  stageQuestionsState,
  stageTalkState,
} from "./stage-display-fixtures";
import "../../../design/fonts-mono.css";
import "./event-screens-preview.css";

const fixedClock = () => TIMERS_FIXTURE_NOW;

function StageDisplay({ state }: { state: LiveRoomState }) {
  return (
    <LiveClockContext.Provider value={fixedClock}>
      <div class="pk-preview__screen">
        <LiveOverlayPresentation
          view="stage-display"
          projection={state}
          roomId={state.outputs["stage-display"].schedule?.rooms[0]?.roomId}
        />
      </div>
    </LiveClockContext.Provider>
  );
}

export const stageDisplaySections: PreviewSection[] = [
  {
    id: "stage-talk",
    title: "Stage display: talk with two timers",
    note: "The timer that ends first is large; reactions show in the top row while they arrive.",
    render: () => <StageDisplay state={stageTalkState} />,
  },
  {
    id: "stage-questions",
    title: "Stage display: questions near the end",
    note: "The operators' banner covers the top row; the question on air, the next one with its votes, and what is next in the room.",
    render: () => <StageDisplay state={stageQuestionsState} />,
  },
  {
    id: "stage-poll",
    title: "Stage display: poll on air",
    render: () => <StageDisplay state={stagePollState} />,
  },
  {
    id: "stage-break",
    title: "Stage display: break",
    render: () => <StageDisplay state={stageBreakState} />,
  },
  {
    id: "stage-before-with-timer",
    title: "Stage display: before the session, with another timer sent",
    note: "The countdown to the session takes the whole screen only when it is the only timer; beside others it is one of them.",
    render: () => <StageDisplay state={stageBeforeWithTimerState} />,
  },
  {
    id: "stage-overtime",
    title: "Stage display: session over time",
    render: () => <StageDisplay state={stageOvertimeState} />,
  },
];
