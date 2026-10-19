import { useEffect, useRef, useState } from "preact/hooks";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { Button } from "../../../../../../../ui/Button";
import { StrokeIcon } from "../../../../../../../ui/MediaIcons";
import { Toast } from "../../../../../../../ui/Toast";
import "./StudioSwitcher.css";

/** The key that takes Preview to Program while no field or control has focus. */
export const TAKE_SHORTCUT = "Space";

/** What the Transition does, said on hover wherever it appears. */
export const TRANSITION_HINT = "Replace Program with Preview. This changes the overlay output, not the stream.";

/**
 * The switcher's Transition: an arrow pointing from Preview to Program, in
 * its own small panel on the desk and between the two pictures on a phone.
 * Labeled, it also says its name.
 */
export function TransitionControl({
  disabled,
  transitioning,
  labeled = false,
  onTransition,
}: {
  disabled: boolean;
  transitioning: boolean;
  labeled?: boolean;
  onTransition: () => void;
}) {
  return (
    <span class="pk-studio-transition">
      <Button
        icon={!labeled}
        variant="primary"
        disabled={disabled}
        loading={transitioning}
        aria-label={labeled ? undefined : "Transition"}
        title={`${TRANSITION_HINT} Shortcut: ${TAKE_SHORTCUT}.`}
        aria-keyshortcuts={TAKE_SHORTCUT}
        onClick={onTransition}
      >
        {labeled ? "Transition" : null}
        <StrokeIcon stroke-width="2">
          <path d="M6 3l5 5-5 5" />
        </StrokeIcon>
      </Button>
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

/** Space takes Preview to Program, the way a switcher's Take bar works, unless something else has the key. */
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
  useEffect(() => {
    if (!undo) return;
    setShown(undo.snapshotId);
    const hide = setTimeout(() => setShown(null), PROGRAM_UNDO_MS);
    return () => clearTimeout(hide);
  }, [undo?.snapshotId]);
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
