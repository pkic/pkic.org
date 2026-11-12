import { useContext, useState } from "preact/hooks";
import { toast } from "../../../../../ui";
import { clockTimeZone, type ClockZone } from "../../../../../../../../shared/event-clock";
import {
  format24HourClockInZone,
  formatClockInZone,
  formatClockName,
  formatDateTimeInZone,
  formatDuration,
} from "../../../../../../../../shared/format-date";
import { instantToCalendarDate } from "../../../../../../../../shared/timezone";
import { formatNumber } from "../../../../../../../../shared/format-number";
import { formatLiveDuration } from "../../../../../../../../shared/live-timer-format";
import {
  countsUp,
  liveTimerCounts,
  liveTimerHasSettings,
  liveTimerTone,
  liveTimerTotalMs,
} from "../../../../../../../../shared/live-timer-policy";
import type {
  LiveRoomClientMessage,
  LiveRoomSession,
  LiveTimer,
} from "../../../../../../../../shared/schemas/live-session-room";
import {
  defaultLiveTimerGraphic,
  type LiveTimerAction,
} from "../../../../../../../../shared/schemas/live-session-timer";
import { confirmAction } from "../../../../../../../components/ConfirmDialog";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { LiveClockContext, useLiveTimerReading } from "../../../../../../../live-session/useLiveCountdown";
import { Button } from "../../../../../../../ui/Button";
import { StrokeIcon } from "../../../../../../../ui/MediaIcons";
import { Menu } from "../../../../../../../ui/Menu";
import { Meter } from "../../../../../../../ui/Meter";
import { LiveTimerGraphicControls } from "../LiveTimerGraphicControls";
import type { LiveTargets } from "../live-output-targets";
import type { nextInRoom } from "./GraphicsPanel";
import { LiveTimerAddForm } from "./LiveTimerAddForm";
import { LiveTimerSettingsDialog } from "./LiveTimerSettingsDialog";
import { StudioCreateAction } from "./StudioCreateAction";
import { Dialog } from "../../../../../../../ui/Dialog";
import "./TimePanel.css";

type Send = (message: LiveRoomClientMessage) => boolean;
type SessionTime = Pick<LiveRoomSession, "startAt" | "endAt" | "timeZone">;

/** The control room warns as the graphics do by default: in the last two minutes, and once over. */
const PANEL_THRESHOLDS = defaultLiveTimerGraphic("session");

/** "warn" in the last minutes of a countdown, "danger" once it is over. */
export function liveTimeTone(timer: Pick<LiveTimer, "kind">, valueMs: number): "danger" | "warn" | undefined {
  const tone = liveTimerTone(timer, valueMs, PANEL_THRESHOLDS);
  return tone === "over" ? "danger" : tone;
}

/** What a timer counts towards on the event's clock, then what it does at zero and whether it sounds. */
function timerDetail(timer: LiveTimer, session: SessionTime, clock: ClockZone): string {
  const parts = [kindDetail(timer, session, clock)];
  if (timer.atZero.action === "stop") parts.push("stops at zero");
  if (timer.atZero.action === "reset")
    parts.push(
      timer.atZero.resetAfterSeconds
        ? `resets ${formatNumber(timer.atZero.resetAfterSeconds)} s over`
        : "resets at zero",
    );
  if (timer.sound.places.length) parts.push("sound on");
  return parts.join(" · ");
}

function kindDetail(timer: LiveTimer, session: SessionTime, clock: ClockZone): string {
  switch (timer.kind) {
    case "session":
      return timer.followsAgenda
        ? `Agenda, ${formatClockInZone(session.startAt, clock)} to ${formatClockInZone(session.endAt, clock)}`
        : `${formatDuration(liveTimerTotalMs(timer, session) ?? 0)} session`;
    case "until":
      return timer.targetAt ? `Until ${onClock(timer.targetAt, session, clock)}` : "Until a time";
    case "duration":
      return formatDuration((timer.durationSeconds ?? 0) * 1000);
    case "stopwatch":
      return "Stopwatch";
    case "clock":
      return `Time of day, ${formatClockName(session.timeZone)}`;
  }
}

/** A time on the event's clock; with its date when it falls on another day than the session. */
function onClock(instant: string, session: SessionTime, clock: ClockZone): string {
  const zone = clockTimeZone(clock);
  return instantToCalendarDate(instant, zone) === instantToCalendarDate(session.startAt, zone)
    ? formatClockInZone(instant, clock)
    : formatDateTimeInZone(instant, clock);
}

const PLAY = <path d="M5 3l8 5-8 5z" />;
const PAUSE = <path d="M5.5 3v10M10.5 3v10" />;

/**
 * One timer in one compact row: its name and what it counts to, its value,
 * and its controls; under them its progress and the outputs that show it.
 * Reset sits beside Start, since operators reach for it between pitches.
 */
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
  session: SessionTime;
  clock: ClockZone;
  disabled: boolean;
  send: Send;
}) {
  const [dialog, setDialog] = useState<"settings" | "graphic" | null>(null);
  const reading = useLiveTimerReading(timer, session);
  const now = useContext(LiveClockContext)();
  const counts = liveTimerCounts(timer);
  const detail = timerDetail(timer, session, clock);
  const total = liveTimerTotalMs(timer, session);
  const before = reading.startsInMs !== null;
  const tone = before ? undefined : liveTimeTone(timer, reading.valueMs);
  const control = (action: LiveTimerAction) => send({ type: "timer.control", timerId: timer.id, action });
  const adjust = (deltaSeconds: number) => send({ type: "timer.adjust", timerId: timer.id, deltaSeconds });
  const remove = async () => {
    const confirmed = await confirmAction({
      title: `Remove ${timer.name}?`,
      body: "Every output showing this timer stops showing it.",
      confirmLabel: "Remove timer",
      tone: "danger",
    });
    if (confirmed) send({ type: "timer.remove", timerId: timer.id });
  };
  const menu = (
    <Menu
      label={`${timer.name} timer`}
      align="end"
      items={[
        ...(timer.kind === "session"
          ? [
              {
                id: "follow",
                label: "Follow the agenda",
                checked: timer.followsAgenda,
                disabled: disabled || timer.followsAgenda,
                onSelect: () => control("follow"),
              },
            ]
          : []),
        ...(liveTimerHasSettings(timer)
          ? [{ id: "settings", label: "Timer settings", disabled, onSelect: () => setDialog("settings") }]
          : []),
        { id: "graphic", label: "Graphic settings", disabled, onSelect: () => setDialog("graphic") },
        {
          id: "remove",
          label: "Remove timer",
          separatorBefore: true,
          disabled,
          onSelect: () =>
            void remove().catch((error: unknown) =>
              toast(error instanceof Error ? error.message : "Could not complete the action.", "error"),
            ),
        },
      ]}
    />
  );
  return (
    <li class="pk-studio-time__row" data-presence-item={`timer:${timer.id}`}>
      <span class="pk-studio-time__name" title={timer.name}>
        {timer.name}
      </span>
      <span class="pk-studio-time__detail" title={detail}>
        {detail}
      </span>
      <output class="pk-studio-time__value" data-tone={tone} aria-label={`${timer.name} time`}>
        {before ? <span class="pk-studio-time__prefix">Starts in </span> : null}
        {counts
          ? formatLiveDuration(before ? (reading.startsInMs ?? 0) : reading.valueMs)
          : format24HourClockInZone(now, session.timeZone)}
      </output>
      {counts ? (
        <span class="pk-studio-time__controls">
          <Button
            icon
            variant={reading.running ? "secondary" : "primary"}
            aria-label={`${reading.running ? "Pause" : "Start"} ${timer.name}`}
            title={reading.running ? "Pause" : before ? "Start now, from its full length" : "Start"}
            disabled={disabled}
            onClick={() => control(reading.running ? "pause" : "start")}
          >
            <StrokeIcon>{reading.running ? PAUSE : PLAY}</StrokeIcon>
          </Button>
          <Button
            aria-label={`Reset ${timer.name}`}
            title={timer.kind === "until" ? "Count to its time again" : "Back to its full length, stopped"}
            disabled={disabled}
            onClick={() => control("reset")}
          >
            Reset
          </Button>
          <Button aria-label={`Take a minute from ${timer.name}`} disabled={disabled} onClick={() => adjust(-60)}>
            −1m
          </Button>
          <Button aria-label={`Add a minute to ${timer.name}`} disabled={disabled} onClick={() => adjust(60)}>
            +1m
          </Button>
          {menu}
        </span>
      ) : null}
      {total !== null && !countsUp(timer) ? (
        <Meter
          class="pk-studio-time__meter"
          label={`${timer.name} time used`}
          value={Math.max(0, total - reading.valueMs)}
          max={Math.max(total, 1)}
          tone={tone === "danger" ? "danger" : tone === "warn" ? "warn" : "accent"}
        />
      ) : (
        <span class="pk-studio-time__meter" />
      )}
      <span class="pk-studio-time__outputs">
        <LiveTimerGraphicControls
          targets={targets}
          timerId={timer.id}
          settingsOpen={dialog === "graphic"}
          onSettingsClose={() => setDialog(null)}
        />
        {counts ? null : menu}
      </span>
      {dialog === "settings" ? (
        <LiveTimerSettingsDialog timer={timer} send={send} onClose={() => setDialog(null)} />
      ) : null}
    </li>
  );
}

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
