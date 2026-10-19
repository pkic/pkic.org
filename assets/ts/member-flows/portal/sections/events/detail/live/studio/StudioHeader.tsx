import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatClockInZone, formatClockName, formatClockRangeInZone } from "../../../../../../../../shared/format-date";
import type { ClockZone } from "../../../../../../../../shared/event-clock";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { liveSessionTiming, liveSessionTimingText } from "../../../../../../../../shared/live-session-agenda";
import type { LiveTimer } from "../../../../../../../../shared/schemas/live-session-room";
import { useLiveTimerValue } from "../../../../../../../live-session/useLiveCountdown";
import { LiveStudioOperators } from "../presence/LiveStudioOperators";
import { liveTimeTone } from "./TimePanel";
import "./StudioHeader.css";

/** The room's wall clock on the event's clock, ticking each second. */
function StudioClock({ clock }: { clock: ClockZone }) {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => clearInterval(tick);
  }, []);
  return (
    <time class="pk-studio-header__clock" dateTime={now} title={formatClockName(clock)}>
      {formatClockInZone(now, clock)}
    </time>
  );
}

/** Ticks once a second while mounted, for the session's timing against now. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  return now;
}

/**
 * Where the session stands against now, on the event's clock: starting in a
 * while, time left, over time, or ended. A running session timer an operator
 * adjusted is the measure while the session runs.
 */
export function SessionTiming({
  session,
  timer,
  active,
  clock,
}: {
  session: { startAt: string; endAt: string };
  timer: LiveTimer | undefined;
  /** Whether this is the room's active session, which runs over rather than ends. */
  active: boolean;
  clock: ClockZone;
}) {
  const now = useNow();
  const value = useLiveTimerValue(timer);
  const timing = liveSessionTiming(session, now, active, timer?.running ? value : null);
  // Active before its start is ordinary in rehearsal: said on hover, not colored.
  const early = active && timing.state === "upcoming";
  const tone =
    timing.state === "over"
      ? "danger"
      : timing.state === "running" && timer
        ? liveTimeTone(timer, timing.leftMs)
        : undefined;
  return (
    <span
      class="pk-studio-header__left"
      data-tone={tone}
      data-timing={timing.state}
      title={early ? "Made active before its start" : undefined}
    >
      {liveSessionTimingText(timing, session, clock)}
    </span>
  );
}

/** One line of room status for the session bar: a refusal, a lost connection or the agenda moving on. */
export interface StudioNoticeContent {
  tone: "warn" | "danger";
  text: string;
  /** A control that resolves it, such as going to the agenda's session. */
  action?: ComponentChildren;
}

/**
 * The session bar's status line. It always holds its place, empty or not, and
 * keeps to one line, so a status coming or going never moves the panels below.
 */
export function StudioNotice({ notice }: { notice: StudioNoticeContent | null }) {
  return (
    // A refusal interrupts; a lost connection or the agenda moving on is announced politely.
    <span
      class="pk-studio-header__notice"
      role={notice?.tone === "danger" ? "alert" : "status"}
      data-tone={notice?.tone}
    >
      {notice ? (
        <>
          <span class="pk-studio-header__notice-text" title={notice.text}>
            {notice.text}
          </span>
          {notice.action}
        </>
      ) : null}
    </span>
  );
}

/**
 * The control room's header: which room and session, whether it is on air and
 * how long it has left, who else is operating it, and the room's clock.
 */
export function StudioHeader({
  state,
  clock,
  roomControl,
  sessionStatus,
  active,
  notice,
}: {
  /** The room's status line, if anything needs saying. */
  notice: StudioNoticeContent | null;
  /** Whether this session is the room's active session. */
  active: boolean;
  state: LiveRoomState;
  clock: ClockZone;
  roomControl?: ComponentChildren;
  sessionStatus?: ComponentChildren;
}) {
  const { session } = state;
  const sessionTimer = state.timers.find((timer) => timer.kind === "session");
  return (
    <div class="pk-studio-header">
      {roomControl}
      <div class="pk-studio-header__session">
        <span class="pk-studio-header__range">{formatClockRangeInZone(session.startAt, session.endAt, clock)}</span>
        <strong class="pk-studio-header__title" title={session.title}>
          {session.title}
        </strong>
        {sessionStatus}
        <SessionTiming session={session} timer={sessionTimer} active={active} clock={clock} />
        <StudioNotice notice={notice} />
      </div>
      <LiveStudioOperators state={state} />
      <StudioClock clock={clock} />
    </div>
  );
}
