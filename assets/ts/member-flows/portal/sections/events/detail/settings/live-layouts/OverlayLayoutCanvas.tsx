import { useId, useLayoutEffect, useRef } from "preact/hooks";
import { layoutLabelShifts } from "./overlay-layout-labels";
import {
  LIVE_OVERLAY_ELEMENT_LABELS,
  type LiveOverlayElement,
  type LiveOverlayLayoutElements,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { LAYOUT_CANVAS_LABEL } from "./overlay-layout-copy";
import { CORNER_HANDLES, nudgeBox, type Box } from "./overlay-layout-editing";
import { describeGraphicPosition } from "./overlay-layout-graphics";
import { placeLayoutBox, useOverlayLayoutGesture } from "./useOverlayLayoutGesture";
import "./OverlayLayoutCanvas.css";

const ARROWS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;

/** A graphic's box on the canvas, labeled and kept at its place through custom properties, never an inline style. */
function LayoutBox({
  element,
  box,
  background,
  selected,
  labelShift,
  describedBy,
  cell,
  handlers,
  onSelect,
  onNudge,
}: {
  element: LiveOverlayElement;
  box: Box;
  background: boolean;
  selected: boolean;
  /** How many label lines the label moves down (or up) so it never covers another box's label. */
  labelShift: number;
  describedBy: string;
  cell: (node: HTMLElement | null) => void;
  handlers: ReturnType<typeof useOverlayLayoutGesture>["handlers"];
  onSelect: () => void;
  onNudge: (box: Box) => void;
}) {
  const node = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (!node.current) return;
    placeLayoutBox(node.current, box);
    node.current.style.setProperty("--label-shift", String(labelShift));
  }, [box, labelShift]);
  const label = LIVE_OVERLAY_ELEMENT_LABELS[element];
  const position = describeGraphicPosition(box);
  const move = handlers("move", element);
  return (
    <button
      type="button"
      ref={(current) => {
        node.current = current;
        cell(current);
      }}
      class="pk-layout-canvas__box"
      data-element={element}
      data-selected={selected ? "" : undefined}
      data-background={background ? "" : undefined}
      aria-pressed={selected}
      aria-label={`${label}, ${position}: ${percent(box.x)} from left, ${percent(box.y)} from top, ${percent(box.w)} wide, ${percent(box.h)} high`}
      aria-describedby={describedBy}
      onFocus={onSelect}
      onClick={onSelect}
      onKeyDown={(event) => {
        const direction = ARROWS[event.key];
        if (!direction) return;
        event.preventDefault();
        onNudge(nudgeBox(box, direction, event.shiftKey));
      }}
      {...move}
      onPointerDown={(event: PointerEvent) => {
        // Pressing a box picks it, so the list and the exact position follow the box being dragged.
        onSelect();
        move.onPointerDown(event);
      }}
    >
      <span class="pk-layout-canvas__label" aria-hidden="true">
        <span class="pk-layout-canvas__name">{label}</span>
        {selected ? (
          <span class="pk-layout-canvas__detail">{background ? `${position} · background on` : position}</span>
        ) : null}
      </span>
      {selected
        ? CORNER_HANDLES.map((handle) => (
            <span
              key={handle}
              class="pk-layout-canvas__handle"
              data-handle={handle}
              aria-hidden="true"
              {...handlers(handle, element)}
            />
          ))
        : null}
    </button>
  );
}

/**
 * The scene on a 16:9 canvas: a labeled box for each graphic it shows, over
 * the camera. Drag a box to move it, a corner to resize it; it snaps to the
 * grid, the title-safe area and the other boxes, with guides while it does.
 * The arrow keys move the selected box.
 */
export function OverlayLayoutCanvas({
  elements,
  shown,
  selected,
  safeAreas,
  onSelect,
  onChange,
}: {
  elements: LiveOverlayLayoutElements;
  /** The graphics the scene shows, front first. */
  shown: readonly LiveOverlayElement[];
  selected: LiveOverlayElement | null;
  /** Whether the action-safe and title-safe guides are drawn. */
  safeAreas: boolean;
  onSelect: (element: LiveOverlayElement) => void;
  onChange: (element: LiveOverlayElement, box: Box) => void;
}) {
  const help = useId();
  const gesture = useOverlayLayoutGesture(
    elements,
    (moving) => shown.filter((element) => element !== moving).map((element) => elements[element]),
    onChange,
  );
  const shifts = layoutLabelShifts(elements, shown, LIVE_OVERLAY_ELEMENT_LABELS);
  return (
    <figure class="pk-layout-canvas-figure">
      <div class="pk-layout-canvas" ref={gesture.canvas}>
        <span class="pk-layout-canvas__camera" aria-hidden="true">
          Camera
        </span>
        {safeAreas ? (
          <>
            <div class="pk-layout-canvas__safe" data-area="action" aria-hidden="true">
              <span>Action safe</span>
            </div>
            <div class="pk-layout-canvas__safe" data-area="title" aria-hidden="true">
              <span>Title safe</span>
            </div>
          </>
        ) : null}
        <div class="pk-layout-canvas__guide" data-axis="vertical" ref={gesture.verticalGuide} aria-hidden="true" />
        <div class="pk-layout-canvas__guide" data-axis="horizontal" ref={gesture.horizontalGuide} aria-hidden="true" />
        <div class="pk-layout-canvas__boxes" role="group" aria-label={LAYOUT_CANVAS_LABEL}>
          {/* Larger boxes underneath, so a small one inside them stays reachable; the stylesheet lifts the selected one. */}
          {[...shown]
            .sort((a, b) => elements[b].w * elements[b].h - elements[a].w * elements[a].h)
            .map((element) => (
              <LayoutBox
                key={element}
                element={element}
                box={elements[element]}
                background={elements[element].background === true}
                selected={element === selected}
                labelShift={shifts[element] ?? 0}
                describedBy={help}
                cell={gesture.register(element)}
                handlers={gesture.handlers}
                onSelect={() => onSelect(element)}
                onNudge={(box) => onChange(element, box)}
              />
            ))}
        </div>
      </div>
      <figcaption class="pk-small pk-muted">
        Graphics keep clear of the ticker while it is on air; with the ticker off, they use the full height.
      </figcaption>
      <p id={help} class="pk-sr-only">
        Arrow keys move the selected box by one pixel, Shift and an arrow key by 24. Hold Alt while dragging to place it
        without snapping.
      </p>
    </figure>
  );
}
