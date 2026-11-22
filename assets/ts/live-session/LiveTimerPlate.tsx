import { useNumericCssProperties } from "../hooks/useNumericCssProperties";

/** The digit looks: a white plate, white digits with no background, or a tab from the frame's edge. */
export type LiveTimerPlateLook = "plate" | "bare" | "tab";

/**
 * A timer as digits, its label beside the time, in one of the digit looks.
 * As a plate it is white with the event stripe at its foot; bare, the time is
 * white on the picture with a soft shadow; as a tab, the plate runs on to the
 * frame's edge (`edge`) by `reach` px of its own 336 x 120 size, the stripe on
 * the side that faces the picture. On a board it drops the plate and sets the
 * time on the board itself, so no card sits on a card.
 */
export function LiveTimerPlate({
  label,
  text,
  tone,
  running,
  look,
  onBoard = false,
  edge = "top",
  reach = 0,
}: {
  label: string | null;
  text: string;
  tone: "warn" | "over" | undefined;
  running: boolean;
  look: LiveTimerPlateLook;
  onBoard?: boolean;
  edge?: "top" | "bottom";
  reach?: number;
}) {
  const geometry = useNumericCssProperties({ "--timer-reach": reach });
  return (
    <div
      class="pk-live-overlay__timer"
      data-look={look === "plate" ? undefined : look}
      data-edge={look === "tab" ? edge : undefined}
      data-tone={tone}
      data-on-board={onBoard ? "" : undefined}
      data-paused={running ? undefined : ""}
      data-numeric-css-properties={look === "tab" ? geometry : undefined}
    >
      {label ? <span class="pk-live-overlay__timer-label">{label}</span> : null}
      <span class="pk-live-overlay__timer-value">{text}</span>
    </div>
  );
}
