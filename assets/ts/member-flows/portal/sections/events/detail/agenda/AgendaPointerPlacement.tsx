import { snapAgendaInstant } from "./schedule-time-controls";
import { agendaMovedAdditionalRoomIds } from "../../../../../../../shared/event-agenda-rooms";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { formatTimeRangeInZone } from "../../../../../../../shared/format-date";

type Candidate = {
  startAt: string;
  endAt: string;
  roomId: string;
  roomIds?: string[];
  top: number;
  left: number;
  width: number;
  height: number;
};

/** Pointer gestures follow the rendered calendar, including occupied rowspan cells. */
export function AgendaPointerPlacement({
  children,
  snapshot,
  disabled,
  timeStep = 5,
  onMove,
  onResize,
  onResizeStart,
  onRoomResize,
}: {
  children: ComponentChildren;
  snapshot: AgendaSnapshot;
  disabled: boolean;
  timeStep?: number;
  onMove: (id: string, startAt: string, roomId: string) => void;
  onResize: (id: string, endAt: string, roomId: string) => void;
  onResizeStart?: (id: string, startAt: string, roomId: string) => void;
  onRoomResize?: (id: string, roomIds: string[]) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    pointerId: number;
    id: string;
    resize: boolean;
    startEdge: boolean;
    roomEdge: "left" | "right" | null;
    roomAnchor: number;
    x: number;
    y: number;
    offset: number;
    card: HTMLElement;
    preview: HTMLElement | null;
    layer: HTMLElement | null;
    sheet: CSSStyleSheet | null;
    candidate: Candidate | null;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  function clear() {
    const current = gesture.current;
    gesture.current = null;
    if (current?.moved) suppressClick.current = true;
    current?.layer?.remove();
    if (current?.sheet)
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== current.sheet);
    current?.card.removeAttribute("data-agenda-pointer-source");
    if (current && root.current?.hasPointerCapture(current.pointerId))
      root.current.releasePointerCapture(current.pointerId);
  }
  useEffect(() => {
    if (disabled) clear();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    document.addEventListener("keydown", escape);
    return () => {
      clear();
      document.removeEventListener("keydown", escape);
    };
  }, [disabled, snapshot.revision]);
  function candidateAt(x: number, y: number): Candidate | null {
    const current = gesture.current;
    if (!current || !root.current) return null;
    const occurrence = snapshot.occurrences.find((value) => value.id === current.id);
    if (!occurrence?.startAt || !occurrence.endAt) return null;
    const table = current.card.closest("table");
    if (!table) return null;
    const headers = [...table.querySelectorAll<HTMLElement>("thead th")].slice(1, snapshot.rooms.length + 1);
    const roomIndex = headers.findIndex((header) => {
      const box = header.getBoundingClientRect();
      return x >= box.left && x < box.right;
    });
    if (current.roomEdge) {
      if (roomIndex < 0) return null;
      const first = current.roomEdge === "left" ? roomIndex : current.roomAnchor;
      const last = current.roomEdge === "right" ? roomIndex : current.roomAnchor;
      if (first > last) return null;
      const roomIds = snapshot.rooms.slice(first, last + 1).map((room) => room.id);
      const box = current.card.getBoundingClientRect();
      const left = headers[first].getBoundingClientRect().left;
      const right = headers[last].getBoundingClientRect().right;
      return {
        startAt: occurrence.startAt,
        endAt: occurrence.endAt,
        roomId: occurrence.roomId ?? "",
        roomIds,
        top: box.top,
        left,
        width: right - left,
        height: box.height,
      };
    }
    const roomId = current.resize ? (occurrence.roomId ?? "") : snapshot.rooms[roomIndex]?.id;
    if (roomIndex < 0 || roomId === undefined) return null;
    if (
      current.resize &&
      occurrence.roomId &&
      ![occurrence.roomId, ...(occurrence.additionalRoomIds ?? [])].includes(snapshot.rooms[roomIndex].id)
    )
      return null;
    const rows = [...table.querySelectorAll<HTMLElement>("tr[data-agenda-start]")];
    const point = current.resize ? y : y - current.offset;
    const row = rows.reduce<HTMLElement | null>(
      (nearest, item) =>
        !nearest ||
        Math.abs(item.getBoundingClientRect().top - point) < Math.abs(nearest.getBoundingClientRect().top - point)
          ? item
          : nearest,
      null,
    );
    const start = row?.dataset.agendaStart;
    if (
      !row ||
      !start ||
      point < rows[0].getBoundingClientRect().top ||
      point > rows.at(-1)!.getBoundingClientRect().bottom
    )
      return null;
    const snapped = snapAgendaInstant(start, snapshot.timeZone, timeStep);
    const startAt = current.resize && !current.startEdge ? occurrence.startAt : snapped;
    const endAt = current.startEdge
      ? occurrence.endAt
      : current.resize
        ? snapped
        : new Date(Date.parse(snapped) + Date.parse(occurrence.endAt) - Date.parse(occurrence.startAt)).toISOString();
    if (endAt <= startAt) return null;
    function boundary(instant: string) {
      const exact = rows.find((item) => item.dataset.agendaStart === instant);
      if (exact) return exact.getBoundingClientRect().top;
      const index = rows.findIndex(
        (item, index) =>
          item.dataset.agendaStart! <= instant && (rows[index + 1]?.dataset.agendaStart ?? "") >= instant,
      );
      if (index < 0) return null;
      const before = rows[index];
      const after = rows[index + 1];
      const fraction =
        (Date.parse(instant) - Date.parse(before.dataset.agendaStart!)) /
        (Date.parse(after.dataset.agendaStart!) - Date.parse(before.dataset.agendaStart!));
      return (
        before.getBoundingClientRect().top +
        fraction * (after.getBoundingClientRect().top - before.getBoundingClientRect().top)
      );
    }
    const top = boundary(startAt);
    const bottom = boundary(endAt);
    if (top === null || bottom === null) return null;
    const representedRooms = roomId
      ? [
          roomId,
          ...(current.resize ? (occurrence.additionalRoomIds ?? []) : agendaMovedAdditionalRoomIds(occurrence, roomId)),
        ]
      : snapshot.rooms.map((room) => room.id);
    const representedBoxes = headers
      .filter((_, index) => representedRooms.includes(snapshot.rooms[index].id))
      .map((header) => header.getBoundingClientRect());
    const left = Math.min(...representedBoxes.map((box) => box.left));
    const right = Math.max(...representedBoxes.map((box) => box.right));
    return { startAt, endAt, roomId, top, left, width: right - left, height: bottom - top };
  }
  function preview(candidate: Candidate | null) {
    const current = gesture.current;
    if (!current) return;
    if (!current.preview) {
      const clone = current.card.cloneNode(true) as HTMLElement;
      clone.removeAttribute("id");
      clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      clone.querySelectorAll("dialog").forEach((element) => element.remove());
      clone.setAttribute("aria-hidden", "true");
      clone.inert = true;
      clone.classList.add("pk-agenda-editor__pointer-preview");
      const sheet = new CSSStyleSheet();
      if (typeof sheet.replaceSync !== "function") return;
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      const layer = document.createElement("div");
      layer.className = "pk-content-agenda pk-agenda-editor__pointer-preview-layer";
      layer.append(clone);
      document.body.append(layer);
      current.layer = layer;
      current.sheet = sheet;
      current.preview = clone;
      current.card.setAttribute("data-agenda-pointer-source", "");
    }
    const clone = current.preview;
    clone.hidden = !candidate;
    if (!candidate) return;
    current.sheet?.replaceSync(
      `.pk-agenda-editor__pointer-preview { left:${candidate.left}px; top:${candidate.top}px; width:${candidate.width}px; height:${candidate.height}px; }`,
    );
    const roomIds = candidate.roomIds;
    clone.dataset.placementLabel = [
      formatTimeRangeInZone(candidate.startAt, candidate.endAt, snapshot.timeZone),
      ...(roomIds
        ? [
            snapshot.rooms
              .filter((room) => roomIds.includes(room.id))
              .map((room) => room.name)
              .join(" · "),
          ]
        : []),
    ].join(" · ");
  }
  return (
    <div
      ref={root}
      class="pk-agenda-editor__pointer-calendar"
      data-interactions-disabled={disabled ? "" : undefined}
      onPointerDown={(event) => {
        suppressClick.current = false;
        if (gesture.current || disabled || event.button !== 0 || !(event.target instanceof Element)) return;
        const card = event.target.closest<HTMLElement>(".pk-content-agenda__timeline [data-agenda-occurrence]");
        if (!card || !root.current?.contains(card)) return;
        const roomHandle = event.target.closest<HTMLElement>("[data-agenda-resize-room-edge]");
        const roomEdge = roomHandle?.dataset.agendaResizeRoomEdge;
        const resizingRooms = roomEdge === "left" || roomEdge === "right";
        if (roomHandle && (!resizingRooms || !onRoomResize || roomHandle.matches(":disabled"))) return;
        const resize = resizingRooms || Boolean(event.target.closest(".pk-agenda-editor__resize"));
        if (
          !resize &&
          event.target.closest(
            "a, input, select, textarea, [data-agenda-card-control], button:not(.pk-content-agenda__title-action)",
          )
        )
          return;
        const id = card.dataset.agendaOccurrence!;
        const occurrence = snapshot.occurrences.find((value) => value.id === id);
        if (!occurrence?.startAt || !occurrence.endAt) return;
        const cell = card.closest("td");
        const headers = [...(card.closest("table")?.querySelectorAll<HTMLElement>("thead th") ?? [])].slice(
          1,
          snapshot.rooms.length + 1,
        );
        const cellBox = cell?.getBoundingClientRect();
        const coveredColumns = headers.flatMap((header, index) => {
          const box = header.getBoundingClientRect();
          const center = (box.left + box.right) / 2;
          return cellBox && center >= cellBox.left && center < cellBox.right ? [index] : [];
        });
        const roomAnchor = roomEdge === "left" ? coveredColumns.at(-1) : coveredColumns[0];
        if (resizingRooms && roomAnchor === undefined) return;
        suppressClick.current = false;
        gesture.current = {
          pointerId: event.pointerId,
          id,
          resize,
          startEdge: Boolean(event.target.closest('[data-agenda-resize-edge="start"]')),
          roomEdge: resizingRooms ? roomEdge : null,
          roomAnchor: roomAnchor ?? -1,
          x: event.clientX,
          y: event.clientY,
          offset: event.clientY - card.closest("tr")!.getBoundingClientRect().top,
          card,
          preview: null,
          layer: null,
          sheet: null,
          candidate: null,
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const distance = current.roomEdge
          ? Math.abs(event.clientX - current.x)
          : Math.hypot(event.clientX - current.x, event.clientY - current.y);
        if (!current.moved && distance < 4) return;
        event.preventDefault();
        if (!current.moved) event.currentTarget.setPointerCapture(event.pointerId);
        current.moved = true;
        current.candidate = candidateAt(event.clientX, event.clientY);
        preview(current.candidate);
      }}
      onPointerUp={(event) => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const candidate = current.candidate;
        suppressClick.current = current.moved;
        clear();
        if (!disabled && current.moved && candidate && current.preview) {
          if (current.roomEdge && candidate.roomIds) {
            const occurrence = snapshot.occurrences.find((value) => value.id === current.id);
            const previousRooms = occurrence
              ? [occurrence.roomId, ...(occurrence.additionalRoomIds ?? [])].filter(Boolean)
              : [];
            if (
              previousRooms.length !== candidate.roomIds.length ||
              candidate.roomIds.some((id) => !previousRooms.includes(id))
            )
              onRoomResize?.(current.id, candidate.roomIds);
          } else if (current.startEdge) onResizeStart?.(current.id, candidate.startAt, candidate.roomId);
          else if (current.resize) onResize(current.id, candidate.endAt, candidate.roomId);
          else onMove(current.id, candidate.startAt, candidate.roomId);
        }
      }}
      onDragStartCapture={(event) => {
        if (gesture.current) event.preventDefault();
      }}
      onPointerCancel={clear}
      onLostPointerCapture={clear}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      {children}
    </div>
  );
}
