import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import type { AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";

export type AgendaSessionWindow = Pick<AgendaOccurrence, "startAt" | "endAt" | "roomId">;

/** A new session window follows the rendered calendar's original instants and room column. */
export function AgendaWindowSelection({
  children,
  disabled,
  onSelect,
}: {
  children: ComponentChildren;
  disabled: boolean;
  onSelect: (window: AgendaSessionWindow) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const selecting = useRef<{
    pointerId: number;
    roomId: string;
    startAt: string;
    endAt: string;
    anchorStartAt: string;
    anchorEndAt: string;
  } | null>(null);
  function cellAt(x: number, y: number) {
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>("td[data-agenda-cell]");
    if (!cell || !root.current?.contains(cell) || cell.querySelector("[data-agenda-occurrence]")) return null;
    const row = cell.closest<HTMLElement>("[data-agenda-start]");
    const startAt = row?.dataset.agendaStart;
    const endAt = row?.dataset.agendaEnd;
    const roomId = cell.dataset.agendaCell;
    return startAt && endAt && roomId && endAt > startAt ? { startAt, endAt, roomId } : null;
  }
  function mark() {
    const selection = selecting.current;
    root.current?.querySelectorAll<HTMLElement>("td[data-agenda-cell]").forEach((cell) => {
      const startsAt = cell.closest<HTMLElement>("[data-agenda-start]")?.dataset.agendaStart;
      cell.toggleAttribute(
        "data-agenda-window-selected",
        Boolean(
          selection &&
          startsAt &&
          cell.dataset.agendaCell === selection.roomId &&
          startsAt >= selection.startAt &&
          startsAt < selection.endAt,
        ),
      );
    });
  }
  function clear() {
    selecting.current = null;
    mark();
  }
  return (
    <div
      ref={root}
      class="pk-agenda-editor__window-selection"
      onPointerDown={(event) => {
        if (
          disabled ||
          event.button !== 0 ||
          !(event.target instanceof Element) ||
          event.target.closest(
            'button, a, input, select, textarea, [data-agenda-occurrence], [data-agenda-card-control], [role="menu"]',
          )
        )
          return;
        const cell = cellAt(event.clientX, event.clientY);
        if (!cell) return;
        if (event.pointerType === "mouse") event.preventDefault();
        selecting.current = {
          ...cell,
          pointerId: event.pointerId,
          anchorStartAt: cell.startAt,
          anchorEndAt: cell.endAt,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        mark();
      }}
      onPointerMove={(event) => {
        const selection = selecting.current;
        if (!selection || selection.pointerId !== event.pointerId) return;
        const cell = cellAt(event.clientX, event.clientY);
        if (!cell || cell.roomId !== selection.roomId) return;
        selecting.current = {
          ...selection,
          startAt: cell.startAt < selection.anchorStartAt ? cell.startAt : selection.anchorStartAt,
          endAt: cell.endAt > selection.anchorEndAt ? cell.endAt : selection.anchorEndAt,
        };
        mark();
      }}
      onPointerUp={(event) => {
        const selection = selecting.current;
        if (!selection || selection.pointerId !== event.pointerId) return;
        clear();
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (!disabled) onSelect({ roomId: selection.roomId, startAt: selection.startAt, endAt: selection.endAt });
      }}
      onPointerCancel={clear}
      onLostPointerCapture={clear}
    >
      {children}
    </div>
  );
}
