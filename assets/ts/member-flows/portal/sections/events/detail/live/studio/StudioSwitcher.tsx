import { useEffect, useRef, useState } from "preact/hooks";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import {
  LIVE_PROGRAM_OUTPUT_DETAILS,
  liveOutputDetails,
  liveTakeTargets,
  type LiveTakeTarget,
} from "../../../../../../../../shared/live-room-outputs";
import type { LiveRoomOutput } from "../../../../../../../../shared/schemas/live-room-output-setup";
import { Button } from "../../../../../../../ui/Button";
import { StrokeIcon } from "../../../../../../../ui/MediaIcons";
import { Toast } from "../../../../../../../ui/Toast";
import { liveTallyAttributes } from "../live-tally";
import "../live-tally.css";
import "./StudioSwitcher.css";

/** The key that runs the Transition while no field or control has focus. */
export const TAKE_SHORTCUT = "Space";

/** What the Transition does, said on hover wherever it appears. */
export const TRANSITION_HINT = "Replace Program with Preview. This changes the overlay output, not the stream.";

/** What a Transition to a screen does: the screen shows Preview; Program stays as it is. */
const SCREEN_TRANSITION_HINT = (screen: string) => `Show Preview on ${screen}. Program stays as it is.`;

/**
 * The switcher's Transition: one take button per output that shows what you
 * take to it, stacked, each an arrow and that output's code in its tally
 * color. Program first; Space is its shortcut. In its own small panel on the
 * desk and between the two pictures on a phone. Labeled, the buttons say the
 * output's full name.
 */
export function TransitionControl({
  outputs,
  disabled,
  transitioning,
  labeled = false,
  onTransition,
}: {
  /** The room's outputs; each one that shows what you take to it gets a button after Program's. */
  outputs: readonly LiveRoomOutput[];
  disabled: boolean;
  /** The output a take is on its way to, while it is. */
  transitioning: LiveTakeTarget | null;
  labeled?: boolean;
  onTransition: (target: LiveTakeTarget) => void;
}) {
  return (
    <span class="pk-studio-transition">
      {liveTakeTargets(outputs).map((target) => {
        const program = target === "program";
        const details = program ? LIVE_PROGRAM_OUTPUT_DETAILS : liveOutputDetails(outputs, target);
        const hint = program ? `${TRANSITION_HINT} Shortcut: ${TAKE_SHORTCUT}.` : SCREEN_TRANSITION_HINT(details.label);
        return (
          <Button
            key={target}
            class="pk-studio-transition__take"
            {...liveTallyAttributes(outputs, target)}
            disabled={disabled}
            loading={transitioning === target}
            aria-label={`Transition to ${details.label}`}
            title={hint}
            aria-keyshortcuts={program ? TAKE_SHORTCUT : undefined}
            onClick={() => onTransition(target)}
          >
            <StrokeIcon stroke-width="2">
              <path d="M6 3l5 5-5 5" />
            </StrokeIcon>
            {labeled ? details.label : details.short}
          </Button>
        );
      })}
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
