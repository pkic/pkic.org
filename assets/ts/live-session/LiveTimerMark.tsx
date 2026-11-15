import { PkicMark } from "../ui/PkicMark";
import { useNumericCssProperties } from "../hooks/useNumericCssProperties";
import "./LiveTimerMark.css";

/** The mark's center, where the table's open middle holds the time, in the mark's own units. */
const CENTER = 180;
/** The width of the table's open middle the time may take, in the mark's units. */
const OPEN_WIDTH = 150;
/** The type size that fits the open middle: two digits large, a longer reading as large as it fits. */
const typeSize = (text: string) => Math.min(100, Math.floor(OPEN_WIDTH / ([...text].length * 0.6)));

/**
 * The timer as the mark: the consortium mark with the time where its keyhole
 * was, for a short countdown such as a pitch. Its rings turn one step a
 * second, a full turn a minute, like a second hand, and on every second it
 * beats once. It warns in the event's orange, and once over reads the time
 * over with a `+`. A paused timer holds still. It draws at its own size in
 * the mark's units, so whatever box it is set in scales it whole.
 */
export function LiveTimerMark({
  text,
  shownMs,
  tone,
  running,
  label,
}: {
  /** What the center reads (see `formatLiveTimerMark`). */
  text: string;
  /** The time shown, so the rings step with its seconds. */
  shownMs: number;
  tone: "warn" | "over" | undefined;
  running: boolean;
  label?: string | null;
}) {
  const seconds = Math.ceil(shownMs / 1000);
  // One step clockwise for every second that goes by, whichever way the time counts.
  const geometry = useNumericCssProperties({ "--mark-turn": -seconds * 6 });
  return (
    <div
      class="pk-live-timer-mark"
      data-tone={tone}
      data-running={running ? "" : undefined}
      // Two names for the same beat: switching between them each second plays it again.
      data-beat={seconds % 2 === 0 ? "even" : "odd"}
      data-numeric-css-properties={geometry}
    >
      <PkicMark class="pk-live-timer-mark__mark" keyhole={false}>
        <circle class="pk-live-timer-mark__ripple" cx={CENTER} cy={CENTER} r="146" />
        <text class="pk-live-timer-mark__time" x={CENTER} y={CENTER + 4} font-size={typeSize(text)}>
          {text}
        </text>
      </PkicMark>
      {label ? <p class="pk-live-timer-mark__label">{label}</p> : null}
    </div>
  );
}
