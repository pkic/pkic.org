import { useContext, useState } from "preact/hooks";
import { toast } from "../../../../../ui";
import type { ClockZone } from "../../../../../../../../shared/event-clock";
import { format24HourClockInZone } from "../../../../../../../../shared/format-date";
import { formatLiveDuration } from "../../../../../../../../shared/live-timer-format";
import { countsUp, liveTimerCounts, liveTimerTotalMs } from "../../../../../../../../shared/live-timer-policy";
import type {
  LiveRoomClientMessage,
  LiveRoomSession,
  LiveTimer,
} from "../../../../../../../../shared/schemas/live-session-room";
import type { LiveTimerAction } from "../../../../../../../../shared/schemas/live-session-timer";
import { confirmAction } from "../../../../../../../components/ConfirmDialog";
import { LiveClockContext, useLiveTimerReading } from "../../../../../../../live-session/useLiveCountdown";
import { Button } from "../../../../../../../ui/Button";
import { StrokeIcon } from "../../../../../../../ui/MediaIcons";
import { Menu, type MenuItem } from "../../../../../../../ui/Menu";
import { Meter } from "../../../../../../../ui/Meter";
import { LiveLayerTargets } from "../LiveLayerTargets";
import { LiveScreenTrigger, liveScreenItems, liveScreens, liveScreensTitle } from "../LiveRowMenu";
import { useLiveTimerGraphic } from "../LiveTimerGraphicControls";
import { LiveLayerDetail, liveLayerUnseenOf } from "../LiveLayerDetail";
import { liveLayerTargets, sendLayerToggle, type LiveTargets } from "../live-output-targets";
import type { LiveDestination } from "../OutputTargetControl";
import { LiveTimerDialog } from "./LiveTimerDialog";
import { liveTimeTone, timerDetail } from "./time-panel-text";

type Send = (message: LiveRoomClientMessage) => boolean;
type SessionTime = Pick<LiveRoomSession, "startAt" | "endAt" | "timeZone">;

const PLAY = <path d="M5 3l8 5-8 5z" />;
const PAUSE = <path d="M5.5 3v10M10.5 3v10" />;
const RESET = <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2M3.5 2.5v2.8h2.8" />;

/** The outputs a graphic can go to, as one-tap switches in the row's menu. */
function outputItems(
  where: ReturnType<typeof liveLayerTargets>,
  toggle: (destination: LiveDestination) => void,
  disabled: boolean,
  screens: readonly MenuItem[],
): MenuItem[] {
  const item = (id: LiveDestination, label: string, checked: boolean, first = false): MenuItem => ({
    id: `output-${id}`,
    label,
    checked,
    multiple: true,
    keepOpen: true,
    separatorBefore: first,
    disabled,
    onSelect: () => toggle(id),
  });
  return [item("preview", "Preview", where.preview, true), item("program", "Program", where.program), ...screens];
}

/**
 * One timer in one row: its name and what it counts to, its value over a
 * thin progress line, where it shows (PVW and PGM), one joined control for
 * Start or Pause, Reset and a minute either way, and the menu. A session
 * timer runs by itself with the agenda, so while it follows the agenda its
 * row offers only a minute either way; once nudged or run by hand, its
 * reset hands it back to the agenda. The row adapts to the panel's width
 * (see TimePanel.css); whatever it hides stays one tap away in the menu,
 * which holds every action. Only setup opens a dialog.
 */
export function TimerRow({
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
  const [dialog, setDialog] = useState(false);
  const reading = useLiveTimerReading(timer, session);
  const now = useContext(LiveClockContext)();
  const { graphic, save, saveLook } = useLiveTimerGraphic(targets, timer.id);
  const layer = { kind: "timer", graphic } as const;
  const counts = liveTimerCounts(timer);
  const detail = timerDetail(timer, session, clock);
  const total = liveTimerTotalMs(timer, session);
  const before = reading.startsInMs !== null;
  const tone = before ? undefined : liveTimeTone(timer, reading.valueMs);
  const startLabel = reading.running ? "Pause" : "Start";
  const agenda = timer.kind === "session";
  const following = agenda && timer.followsAgenda;
  // Before its session starts, a session on the agenda has no time to nudge yet.
  const nudge = disabled || (following && before);
  const nudgeNote = following
    ? "The timer then runs on its own; Follow the agenda goes back."
    : "Every screen that shows the timer follows.";
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
  const live: MenuItem[] = counts
    ? [
        { id: "start", label: startLabel, disabled, onSelect: () => control(reading.running ? "pause" : "start") },
        ...(agenda ? [] : [{ id: "reset", label: "Reset", disabled, onSelect: () => control("reset") }]),
        { id: "minus", label: "Take a minute", keepOpen: true, disabled: nudge, onSelect: () => adjust(-60) },
        { id: "plus", label: "Add a minute", keepOpen: true, disabled: nudge, onSelect: () => adjust(60) },
        ...(agenda
          ? [
              {
                id: "follow",
                label: "Follow the agenda",
                tooltip: "Goes back to the session's times on the agenda, after you nudged or ran the timer by hand.",
                checked: timer.followsAgenda,
                disabled: disabled || timer.followsAgenda,
                onSelect: () => control("follow"),
              },
            ]
          : []),
      ]
    : [];
  const items: MenuItem[] = [
    ...live,
    ...outputItems(
      liveLayerTargets(targets, layer),
      (destination) => sendLayerToggle(targets, layer, destination),
      targets.disabled,
      liveScreenItems(targets, layer),
    ).map((item, index) => (index === 0 && !live.length ? { ...item, separatorBefore: false } : item)),
    {
      id: "settings",
      label: "Timer settings",
      separatorBefore: true,
      disabled,
      onSelect: () => setDialog(true),
    },
    {
      id: "remove",
      label: "Remove timer",
      danger: true,
      separatorBefore: true,
      disabled,
      onSelect: () =>
        void remove().catch((error: unknown) =>
          toast(error instanceof Error ? error.message : "Could not complete the action.", "error"),
        ),
    },
  ];
  return (
    <li class="pk-studio-time__row" data-presence-item={`timer:${timer.id}`}>
      <span class="pk-studio-time__name" title={timer.name}>
        {timer.name}
      </span>
      <LiveLayerDetail class="pk-studio-time__detail" detail={detail} unseen={liveLayerUnseenOf({ targets, layer })} />
      <span class="pk-studio-time__reading">
        <output
          class="pk-studio-time__value"
          data-tone={tone}
          data-before={before ? "" : undefined}
          aria-label={`${timer.name} time`}
        >
          {before ? <span class="pk-studio-time__prefix">Starts in </span> : null}
          {counts
            ? formatLiveDuration(before ? (reading.startsInMs ?? 0) : reading.valueMs)
            : format24HourClockInZone(now, session.timeZone)}
        </output>
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
      </span>
      <span class="pk-studio-time__outputs">
        <LiveLayerTargets targets={targets} subject={`${timer.name} timer`} layer={layer} />
      </span>
      {/* A session waiting on the agenda has nothing to control yet: it starts on time by itself. */}
      {counts && !(following && before) ? (
        // One joined control, like PVW | PGM: Start or Pause, Reset, and a minute either way.
        <span
          class="pk-segmented pk-studio-time__transport"
          role="group"
          aria-label={`${timer.name} controls`}
          data-following={following ? "" : undefined}
        >
          {following ? null : (
            <Button
              icon
              variant={reading.running ? "secondary" : "primary"}
              aria-label={`${startLabel} ${timer.name}`}
              title={`${startLabel} ${timer.name}\n${
                reading.running
                  ? "Hold the timer where it is, on every screen that shows it."
                  : "Run the timer from where it stands."
              }`}
              disabled={disabled}
              onClick={() => control(reading.running ? "pause" : "start")}
            >
              <StrokeIcon>{reading.running ? PAUSE : PLAY}</StrokeIcon>
            </Button>
          )}
          {following ? null : agenda ? (
            <Button
              icon
              aria-label={`${timer.name}: follow the agenda`}
              title={`Follow the agenda\nBack to the session's times on the agenda, without the minutes added or taken.`}
              disabled={disabled}
              onClick={() => control("follow")}
            >
              <StrokeIcon>{RESET}</StrokeIcon>
            </Button>
          ) : (
            <Button
              icon
              aria-label={`Reset ${timer.name}`}
              title={`Reset ${timer.name}\n${
                timer.kind === "until" ? "Count to its set time again." : "Put it back to its full length, stopped."
              }`}
              disabled={disabled}
              onClick={() => control("reset")}
            >
              <StrokeIcon>{RESET}</StrokeIcon>
            </Button>
          )}
          <Button
            class="pk-studio-time__minus"
            aria-label={`Take a minute from ${timer.name}`}
            title={`Take a minute from ${timer.name}\n${nudgeNote}`}
            disabled={nudge}
            onClick={() => adjust(-60)}
          >
            −1m
          </Button>
          <Button
            class="pk-studio-time__plus"
            aria-label={`Add a minute to ${timer.name}`}
            title={`Add a minute to ${timer.name}\n${nudgeNote}`}
            disabled={nudge}
            onClick={() => adjust(60)}
          >
            +1m
          </Button>
        </span>
      ) : null}
      <span class="pk-studio-time__menu">
        <Menu
          label={`${timer.name} timer`}
          heading={timer.name}
          align="end"
          title={liveScreensTitle(liveScreens(targets, layer))}
          items={items}
        >
          <LiveScreenTrigger screens={liveScreens(targets, layer)} />
        </Menu>
      </span>
      {dialog ? (
        <LiveTimerDialog
          timer={timer}
          clock={clock}
          graphic={graphic}
          send={send}
          saveGraphic={save}
          saveLook={saveLook}
          onClose={() => setDialog(false)}
        />
      ) : null}
    </li>
  );
}
