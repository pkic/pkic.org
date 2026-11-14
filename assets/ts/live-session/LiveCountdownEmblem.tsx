import { PkicMark } from "../ui/PkicMark";

/** The ring's radius in its 100 × 100 box; its stroke sits inside the box. */
const RADIUS = 45;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The timer's mark: the consortium mark in one color, the text color, like
 * every icon. With `progress`, a ring around it empties as the countdown runs
 * down, so a glance tells how much is left; a timer that counts up or reads
 * the time of day has no ring. It spins only while the timer runs.
 */
export function LiveCountdownEmblem({ progress, running }: { progress: number | null; running: boolean }) {
  const left = progress === null ? null : Math.min(1, Math.max(0, progress));
  return (
    <span class="pk-live-overlay__timer-mark" data-running={running ? "" : undefined}>
      {left === null ? null : (
        <svg class="pk-live-overlay__timer-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <circle class="pk-live-overlay__timer-ring-track" cx="50" cy="50" r={RADIUS} />
          <circle
            class="pk-live-overlay__timer-ring-left"
            cx="50"
            cy="50"
            r={RADIUS}
            stroke-dasharray={CIRCUMFERENCE}
            stroke-dashoffset={CIRCUMFERENCE * (1 - left)}
          />
        </svg>
      )}
      <PkicMark class="pk-live-overlay__timer-logo" />
    </span>
  );
}
