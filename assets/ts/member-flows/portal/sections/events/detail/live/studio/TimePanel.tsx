import type { ClockZone } from "../../../../../../../../shared/event-clock";
import { formatClockInZone } from "../../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../../shared/format-number";
import {
  countsUp,
  formatLiveTimer,
  liveTimerTone,
  liveTimerTotalMs,
} from "../../../../../../../../shared/live-timer-policy";
import type {
  LiveRoomClientMessage,
  LiveRoomSession,
  LiveTimer,
} from "../../../../../../../../shared/schemas/live-session-room";
import { defaultLiveTimerGraphic } from "../../../../../../../../shared/schemas/live-session-timer";
import { confirmAction } from "../../../../../../../components/ConfirmDialog";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { useLiveTimerValue } from "../../../../../../../live-session/useLiveCountdown";
import { Button } from "../../../../../../../ui/Button";
import { StrokeIcon } from "../../../../../../../ui/MediaIcons";
import { Menu } from "../../../../../../../ui/Menu";
import { Meter } from "../../../../../../../ui/Meter";
import { LiveTimerGraphicControls } from "../LiveTimerGraphicControls";
import type { LiveTargets } from "../live-output-targets";
import type { nextInRoom } from "./GraphicsPanel";
import { LiveTimerAddForm } from "./LiveTimerAddForm";
import { StudioCreateAction } from "./StudioCreateAction";
import { Dialog } from "../../../../../../../ui/Dialog";
import "./TimePanel.css";

type Send = (message: LiveRoomClientMessage) => boolean;

/** The control room warns as the graphics do by default: in the last two minutes, and once over. */
const PANEL_THRESHOLDS = defaultLiveTimerGraphic("session");

/** "warn" in the last minutes of a countdown, "danger" once it is over. */
export function liveTimeTone(timer: Pick<LiveTimer, "kind">, valueMs: number): "danger" | "warn" | undefined {
  const tone = liveTimerTone(timer, valueMs, PANEL_THRESHOLDS);
  return tone === "over" ? "danger" : tone;
}

/** What a timer counts towards, on the event's clock. */
function timerDetail(timer: LiveTimer, session: Pick<LiveRoomSession, "endAt">, clock: ClockZone): string {
  switch (timer.kind) {
    case "session":
      return `Session ends ${formatClockInZone(session.endAt, clock)}`;
    case "until":
      return timer.targetAt ? `Until ${formatClockInZone(timer.targetAt, clock)}` : "Until a time";
    case "duration":
      return `${formatNumber(Math.round((timer.durationSeconds ?? 0) / 60))} min`;
    case "stopwatch":
      return "Stopwatch";
  }
}

function TimerRow({
  timer,
  session,
  clock,
  disabled,
  send,
  targets,
}: {
  targets: LiveTargets;
  timer: LiveTimer;
  session: Pick<LiveRoomSession, "startAt" | "endAt">;
  clock: ClockZone;
  disabled: boolean;
  send: Send;
}) {
  const value = useLiveTimerValue(timer);
  const total = liveTimerTotalMs(timer, session);
  const tone = liveTimeTone(timer, value);
  const format = Math.abs(value) >= 3_600_000 ? "hh:mm:ss" : "mm:ss";
  const control = (action: "start" | "pause" | "reset") => send({ type: "timer.control", timerId: timer.id, action });
  const adjust = (deltaSeconds: number) => send({ type: "timer.adjust", timerId: timer.id, deltaSeconds });
  return (
    <li>
      <div class="pk-studio-time__row" data-presence-item={`timer:${timer.id}`}>
        <span class="pk-studio-time__name" title={timer.name}>
          {timer.name}
        </span>
        <output class="pk-studio-time__value" data-tone={tone} aria-label={`${timer.name} time`}>
          {formatLiveTimer(value, format)}
        </output>
        <span class="pk-studio-time__detail">{timerDetail(timer, session, clock)}</span>
        {total !== null && !countsUp(timer) ? (
          <Meter
            class="pk-studio-time__meter"
            label={`${timer.name} time used`}
            value={Math.max(0, total - value)}
            max={Math.max(total, 1)}
            tone={tone === "danger" ? "danger" : tone === "warn" ? "warn" : "accent"}
          />
        ) : (
          <span class="pk-studio-time__meter" />
        )}
        <span class="pk-studio-time__controls">
          <Button
            icon
            variant={timer.running ? "secondary" : "primary"}
            aria-label={`${timer.running ? "Pause" : "Start"} ${timer.name}`}
            title={timer.running ? "Pause" : "Start"}
            disabled={disabled}
            onClick={() => control(timer.running ? "pause" : "start")}
          >
            <StrokeIcon>{timer.running ? <path d="M5.5 3v10M10.5 3v10" /> : <path d="M5 3l8 5-8 5z" />}</StrokeIcon>
          </Button>
          <Button aria-label={`Take a minute from ${timer.name}`} disabled={disabled} onClick={() => adjust(-60)}>
            −1m
          </Button>
          <Button aria-label={`Add a minute to ${timer.name}`} disabled={disabled} onClick={() => adjust(60)}>
            +1m
          </Button>
          <Menu
            label={`${timer.name} timer`}
            align="end"
            items={[
              {
                id: "reset",
                label: timer.kind === "session" ? "Follow the agenda again" : "Reset",
                disabled,
                onSelect: () => control("reset"),
              },
              {
                id: "remove",
                label: "Remove timer",
                separatorBefore: true,
                disabled,
                onSelect: async () => {
                  const confirmed = await confirmAction({
                    title: `Remove ${timer.name}?`,
                    body: "Every output showing this timer stops showing it.",
                    confirmLabel: "Remove timer",
                    tone: "danger",
                  });
                  if (confirmed) send({ type: "timer.remove", timerId: timer.id });
                },
              },
            ]}
          />
        </span>
      </div>
      <LiveTimerGraphicControls targets={targets} timerId={timer.id} />
    </li>
  );
}

/**
 * The room's timers, one compact row each: name, value, progress and its
 * controls. Below, a short form adds another, and the next session in the
 * room shows how much of its slot an overrun leaves.
 */
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
  const sessionValue = useLiveTimerValue(sessionTimer);
  const overrun = sessionTimer ? Math.max(0, -sessionValue) : 0;
  const slot = next ? Date.parse(next.endAt) - Date.parse(next.startAt) : 0;
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
        <p class="pk-studio-time__next" data-tone={overrun ? "warn" : undefined}>
          <span>
            Next {formatClockInZone(next.startAt, clock)} <strong>{next.title}</strong>
          </span>
          <span>
            {overrun
              ? `${formatLiveTimer(Math.max(0, slot - overrun), "mm:ss")} of its ${formatLiveTimer(slot, "mm:ss")} left`
              : "On schedule"}
          </span>
        </p>
      ) : null}
    </div>
  );
}
