import type { ClockZone } from "../../../../../../../../shared/event-clock";
import { formatClockInZone } from "../../../../../../../../shared/format-date";
import { formatLiveDuration } from "../../../../../../../../shared/live-timer-format";
import type { LiveRoomClientMessage } from "../../../../../../../../shared/schemas/live-session-room";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { useLiveTimerReading } from "../../../../../../../live-session/useLiveCountdown";
import { Dialog } from "../../../../../../../ui/Dialog";
import type { LiveTargets } from "../live-output-targets";
import type { nextInRoom } from "./GraphicsPanel";
import { LiveTimerAddForm } from "./LiveTimerAddForm";
import { StudioCreateAction } from "./StudioCreateAction";
import { TimerRow } from "./TimerRow";
import "./TimePanel.css";

type Send = (message: LiveRoomClientMessage) => boolean;

/** The Time panel's create action: a timer of its own for this room. */
export function LiveAddTimerAction({
  state,
  clock,
  send,
  disabled,
}: {
  state: LiveRoomState;
  clock: ClockZone;
  send: Send;
  disabled: boolean;
}) {
  return (
    <StudioCreateAction label="Add timer" disabled={disabled}>
      {(close) => (
        <Dialog
          viewer
          open
          title="Add a timer"
          closeLabel="Close Add a timer"
          onCancel={close}
          onConfirm={close}
          confirmLabel="Close"
        >
          <LiveTimerAddForm session={state.session} clock={clock} disabled={disabled} send={send} onAdded={close} />
        </Dialog>
      )}
    </StudioCreateAction>
  );
}

/**
 * The room's timers, one compact row each, and under them how much of the
 * next session's slot an overrun leaves.
 */
export function TimePanel({
  state,
  clock,
  send,
  disabled,
  next,
  targets,
}: {
  targets: LiveTargets;
  state: LiveRoomState;
  clock: ClockZone;
  send: Send;
  disabled: boolean;
  next: ReturnType<typeof nextInRoom>;
}) {
  const { session, timers } = state;
  const sessionTimer = timers.find((timer) => timer.kind === "session");
  const sessionReading = useLiveTimerReading(sessionTimer, session);
  const overrun = sessionTimer ? Math.max(0, -sessionReading.valueMs) : 0;
  const slot = next ? Date.parse(next.endAt) - Date.parse(next.startAt) : 0;
  // Overrun first uses up any break before the next session, then its slot.
  const gap = next ? Math.max(0, Date.parse(next.startAt) - Date.parse(session.endAt)) : 0;
  const late = Math.max(0, overrun - gap);
  return (
    <div class="pk-studio-time">
      {timers.length ? (
        <ul class="pk-studio-time__list" aria-label="Timers">
          {timers.map((timer) => (
            <TimerRow
              key={timer.id}
              timer={timer}
              targets={targets}
              session={session}
              clock={clock}
              disabled={disabled}
              send={send}
            />
          ))}
        </ul>
      ) : (
        <p class="pk-studio-time__empty">No timers yet. Use Add timer to start one.</p>
      )}
      {next ? (
        <p class="pk-studio-time__next" data-tone={late ? "warn" : undefined}>
          <span>
            Next {formatClockInZone(next.startAt, clock)} <strong>{next.title}</strong>
          </span>
          <span>
            {late
              ? `${formatLiveDuration(Math.max(0, slot - late))} of its ${formatLiveDuration(slot)} left`
              : "On schedule"}
          </span>
        </p>
      ) : null}
    </div>
  );
}
