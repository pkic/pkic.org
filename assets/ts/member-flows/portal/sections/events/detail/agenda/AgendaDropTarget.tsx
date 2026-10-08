import { formatTimeRangeInZone } from "../../../../../../../shared/format-date";
import { snapAgendaInstant } from "./schedule-time-controls";
/** One explicit candidate for drag, keyboard activation and touch. */
export function AgendaDropTarget({
  instant,
  roomId,
  roomName,
  timeZone,
  timeStep,
  dragged,
  resizing,
  busy,
  invalidResize,
  move,
  resize,
}: {
  instant: string;
  roomId: string;
  roomName: string;
  timeZone: string;
  timeStep: number;
  dragged: string | null;
  resizing: string | null;
  busy: boolean;
  invalidResize: (instant: string, roomId: string) => boolean;
  move: (id: string, instant: string, roomId: string) => void;
  resize: (id: string, instant: string, roomId: string) => void;
}) {
  const candidate = snapAgendaInstant(instant, timeZone, timeStep);
  const invalid = invalidResize(candidate, roomId);
  const label = formatTimeRangeInZone(candidate, undefined, timeZone);
  function select(resizeId = resizing, moveId = dragged) {
    if (busy || invalid) return;
    if (resizeId) resize(resizeId, candidate, roomId);
    else if (moveId) move(moveId, candidate, roomId);
  }
  return (
    <button
      type="button"
      class="pk-agenda-editor__drop"
      disabled={busy || invalid}
      title={invalid ? "Choose a later end time in the current location" : undefined}
      aria-label={`${resizing ? "End selected session" : "Move selected session"} at ${label} in ${roomName}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        select(
          event.dataTransfer?.getData("application/x-pkic-agenda-resize") || resizing,
          event.dataTransfer?.getData("text/plain") || dragged,
        );
      }}
      onClick={() => select()}
    >
      {resizing ? "End selected session here" : "Move selected session here"} · {label} · {roomName}
    </button>
  );
}
