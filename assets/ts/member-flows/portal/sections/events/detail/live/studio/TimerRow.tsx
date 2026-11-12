import { useContext, useState } from "preact/hooks";
import { toast } from "../../../../../ui";
import type { ClockZone } from "../../../../../../../../shared/event-clock";
import { format24HourClockInZone } from "../../../../../../../../shared/format-date";
import { LIVE_AUX_OUTPUTS, LIVE_AUX_OUTPUT_DETAILS } from "../../../../../../../../shared/live-room-outputs";
import { formatLiveDuration } from "../../../../../../../../shared/live-timer-format";
import {
  countsUp,
  liveTimerCounts,
  liveTimerHasSettings,
  liveTimerTotalMs,
} from "../../../../../../../../shared/live-timer-policy";
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
import { LiveTimerGraphicDialog, useLiveTimerGraphic } from "../LiveTimerGraphicControls";
import { liveLayerTargets, sendLayerToggle, type LiveTargets } from "../live-output-targets";
import type { LiveDestination } from "../OutputTargetControl";
import { LiveTimerSettingsDialog } from "./LiveTimerSettingsDialog";
import { liveTimeTone, timerDetail } from "./time-panel-text";

type Send = (message: LiveRoomClientMessage) => boolean;
type SessionTime = Pick<LiveRoomSession, "startAt" | "endAt" | "timeZone">;

const PLAY = <path d="M5 3l8 5-8 5z" />;
const PAUSE = <path d="M5.5 3v10M10.5 3v10" />;

/** The outputs a graphic can go to, as one-tap switches in the row's menu. */
function outputItems(
  where: ReturnType<typeof liveLayerTargets>,
  toggle: (destination: LiveDestination) => void,
  disabled: boolean,
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
  return [
    item("preview", "Preview", where.preview, true),
    item("program", "Program", where.program),
    ...LIVE_AUX_OUTPUTS.map((output) => item(output, LIVE_AUX_OUTPUT_DETAILS[output].label, where.aux(output))),
  ];
}

/**
 * One timer in one row: its name and what it counts to, its value over a
 * thin progress line, where it shows (PVW and PGM), Start or Pause, Reset,
 * a minute either way, and the menu. The row adapts to the panel's width
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
  const [dialog, setDialog] = useState<"settings" | "graphic" | null>(null);
  const reading = useLiveTimerReading(timer, session);
  const now = useContext(LiveClockContext)();
  const { graphic, save } = useLiveTimerGraphic(targets, timer.id);
  const layer = { kind: "timer", graphic } as const;
  const counts = liveTimerCounts(timer);
  const detail = timerDetail(timer, session, clock);
  const total = liveTimerTotalMs(timer, session);
  const before = reading.startsInMs !== null;
  const tone = before ? undefined : liveTimeTone(timer, reading.valueMs);
  const startLabel = reading.running ? "Pause" : "Start";
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
        { id: "reset", label: "Reset", disabled, onSelect: () => control("reset") },
        { id: "minus", label: "Take a minute", keepOpen: true, disabled, onSelect: () => adjust(-60) },
        { id: "plus", label: "Add a minute", keepOpen: true, disabled, onSelect: () => adjust(60) },
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
      ]
    : [];
  const items: MenuItem[] = [
    ...live,
    ...outputItems(
      liveLayerTargets(targets, layer),
      (destination) => sendLayerToggle(targets, layer, destination),
      targets.disabled,
    ).map((item, index) => (index === 0 && !live.length ? { ...item, separatorBefore: false } : item)),
    ...(liveTimerHasSettings(timer)
      ? [
          {
            id: "settings",
            label: "Sounds and at zero",
            separatorBefore: true,
            disabled,
            onSelect: () => setDialog("settings"),
          },
        ]
      : []),
    {
      id: "graphic",
      label: "Edit graphic",
      separatorBefore: !liveTimerHasSettings(timer),
      disabled,
      onSelect: () => setDialog("graphic"),
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
      <span class="pk-studio-time__detail" title={detail}>
        {detail}
      </span>
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
        <LiveLayerTargets targets={targets} subject={`${timer.name} timer`} layer={layer} short />
      </span>
      {counts ? (
        <>
          <Button
            icon
            class="pk-studio-time__start"
            variant={reading.running ? "secondary" : "primary"}
            aria-label={`${startLabel} ${timer.name}`}
            title={startLabel}
            disabled={disabled}
            onClick={() => control(reading.running ? "pause" : "start")}
          >
            <StrokeIcon>{reading.running ? PAUSE : PLAY}</StrokeIcon>
          </Button>
          <Button
            class="pk-studio-time__reset"
            aria-label={`Reset ${timer.name}`}
            disabled={disabled}
            onClick={() => control("reset")}
          >
            Reset
          </Button>
          <Button
            class="pk-studio-time__minus"
            aria-label={`Take a minute from ${timer.name}`}
            disabled={disabled}
            onClick={() => adjust(-60)}
          >
            −1m
          </Button>
          <Button
            class="pk-studio-time__plus"
            aria-label={`Add a minute to ${timer.name}`}
            disabled={disabled}
            onClick={() => adjust(60)}
          >
            +1m
          </Button>
        </>
      ) : null}
      <span class="pk-studio-time__menu">
        <Menu label={`${timer.name} timer`} heading={timer.name} align="end" items={items} />
      </span>
      {dialog === "settings" ? (
        <LiveTimerSettingsDialog timer={timer} send={send} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "graphic" ? (
        <LiveTimerGraphicDialog
          graphic={graphic}
          timerName={timer.name}
          counts={counts}
          onSave={save}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </li>
  );
}
