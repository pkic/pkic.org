import { useEffect, useRef, useState } from "preact/hooks";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import {
  LIVE_AUX_OUTPUT_DETAILS,
  LIVE_PROGRAM_OUTPUT_DETAILS,
  LIVE_TAKE_TARGETS,
  type LiveTakeTarget,
} from "../../../../../../../../shared/live-room-outputs";
import { Button } from "../../../../../../../ui/Button";
import { buttonClasses } from "../../../../../../../ui/button-classes";
import { Menu } from "../../../../../../../ui/Menu";
import { StrokeIcon } from "../../../../../../../ui/MediaIcons";
import { Toast } from "../../../../../../../ui/Toast";
import "../live-tally.css";
import "./StudioSwitcher.css";

/** The key that runs the Transition while no field or control has focus. */
export const TAKE_SHORTCUT = "Space";

/** What the Transition does, said on hover wherever it appears. */
export const TRANSITION_HINT = "Replace Program with Preview. This changes the overlay output, not the stream.";

/** What a Transition to a screen does: the screen shows Preview; Program stays as it is. */
const SCREEN_TRANSITION_HINT = (screen: string) => `Show Preview on the ${screen}. Program stays as it is.`;

const outputName = (target: LiveTakeTarget) =>
  target === "program" ? LIVE_PROGRAM_OUTPUT_DETAILS : LIVE_AUX_OUTPUT_DETAILS[target];

/**
 * The switcher's Transition: an arrow and the output it goes to, in that
 * output's tally color: Program by default, or one of the room's screens,
 * chosen in the menu beside it. In its own small panel on the desk and
 * between the two pictures on a phone. Labeled, it also says its name.
 */
export function TransitionControl({
  disabled,
  transitioning,
  labeled = false,
  target,
  onTarget,
  onTransition,
}: {
  disabled: boolean;
  transitioning: boolean;
  labeled?: boolean;
  target: LiveTakeTarget;
  onTarget: (target: LiveTakeTarget) => void;
  onTransition: () => void;
}) {
  const details = outputName(target);
  const hint = target === "program" ? TRANSITION_HINT : SCREEN_TRANSITION_HINT(details.label.toLowerCase());
  return (
    <span class="pk-studio-transition">
      <span class="pk-segmented pk-studio-transition__split" data-tally={target}>
        <Button
          class="pk-studio-transition__take"
          disabled={disabled}
          loading={transitioning}
          aria-label={`Transition to ${details.label}`}
          title={`${hint} Shortcut: ${TAKE_SHORTCUT}.`}
          aria-keyshortcuts={TAKE_SHORTCUT}
          onClick={onTransition}
        >
          <StrokeIcon stroke-width="2">
            <path d="M6 3l5 5-5 5" />
          </StrokeIcon>
          {labeled ? "Transition to " : null}
          {details.short}
        </Button>
        <Menu
          variant="plain"
          align="end"
          label="Transition to"
          title="Choose where Transition goes"
          triggerClass={buttonClasses({}, "pk-studio-transition__target")}
          heading="Transition to"
          items={LIVE_TAKE_TARGETS.map((output) => ({
            id: output,
            label: outputName(output).label,
            checked: output === target,
            onSelect: () => onTarget(output),
          }))}
        >
          <span aria-hidden="true">▾</span>
        </Menu>
      </span>
    </span>
  );
}

/** How long a cleared Program can be undone from the desk. */
export const PROGRAM_UNDO_MS = 8000;

/** Space on a field, a button, a link or a menu item is theirs; only on the studio itself is it the Take. */
function ownsSpace(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "input, textarea, select, button, a[href], summary, [contenteditable='true'], [contenteditable=''], [role^='menuitem'], [role='tab'], dialog[open]",
      ),
    )
  );
}

/** Space runs the Transition, the way a switcher's Take bar works, unless something else has the key. */
export function useTakeShortcut(take: () => void, enabled: boolean) {
  const latest = useRef(take);
  latest.current = take;
  useEffect(() => {
    if (!enabled) return;
    const press = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (ownsSpace(event.target) || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", press);
    return () => document.removeEventListener("keydown", press);
  }, [enabled]);
}

/**
 * The Undo after Program was cleared, for every operator, for a few seconds:
 * on air there is no time for a confirmation, so the clear is immediate and
 * this puts it back.
 */
export function ProgramUndoToast({
  undo,
  onUndo,
}: {
  undo: LiveRoomState["programUndo"];
  onUndo: (snapshotId: string) => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const snapshotId = undo?.snapshotId;
  useEffect(() => {
    if (!snapshotId) return;
    setShown(snapshotId);
    const hide = setTimeout(() => setShown(null), PROGRAM_UNDO_MS);
    return () => clearTimeout(hide);
  }, [snapshotId]);
  if (!undo || shown !== undo.snapshotId) return null;
  return (
    <div class="pk-studio__toast">
      <Toast
        tone="info"
        message={`${undo.change.operatorName} took everything off air.`}
        action={{
          label: "Undo",
          onSelect: () => {
            onUndo(undo.snapshotId);
            setShown(null);
          },
        }}
        onDismiss={() => setShown(null)}
      />
    </div>
  );
}
