import type { ComponentChildren } from "preact";
import { useId, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { LiveOverlayPresentation } from "../../../../../../../live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { Checkbox } from "../../../../../../../ui/Checkbox";
import { SAFE_AREA_LABELS, layoutLabelPlaces, type LabelPlace } from "./overlay-layout-labels";
import {
  LIVE_OVERLAY_ELEMENT_LABELS,
  type LiveOverlayElement,
  type LiveOverlayLayoutElements,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { LAYOUT_CANVAS_LABEL } from "./overlay-layout-copy";
import { CORNER_HANDLES, nudgeBox, type Box } from "./overlay-layout-editing";
import { describeGraphicPosition } from "./overlay-layout-graphics";
import { sampleOverlayRoom } from "./overlay-layout-sample";
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
  selected,
  off,
  labelPlace,
  describedBy,
  cell,
  handlers,
  onSelect,
  onNudge,
}: {
  element: LiveOverlayElement;
  box: Box;
  selected: boolean;
  /** The graphic is in the scene but has nothing on air: its box is an outline with its name. */
  off: boolean;
  /** Where its name sits along its top or bottom edge, clear of every other name. */
  labelPlace: LabelPlace;
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
    node.current.style.setProperty("--label-along", String(labelPlace.along));
  }, [box, labelPlace.along]);
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
      data-off={off ? "" : undefined}
      data-label-side={labelPlace.side}
      aria-pressed={selected}
      aria-label={`${label}${off ? " (off)" : ""}, ${position}: ${percent(box.x)} from left, ${percent(box.y)} from top, ${percent(box.w)} wide, ${percent(box.h)} high`}
      aria-describedby={describedBy}
      title={`${label} · ${position}\nDrag to move it, or a corner to resize it. The arrow keys move it too.`}
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
        {selected ? <span class="pk-layout-canvas__detail"> · {position}</span> : null}
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
 * The scene on a 16:9 canvas, drawn by the renderer the outputs use with a
 * sample room that has every graphic on, whatever puts it on in the studio,
 * and a box over each graphic the scene includes. Boxes are stacked
 * as the outputs draw them, so a graphic in front covers the ones behind it.
 * Drag a box to move it, a corner to resize it; it snaps to the grid, the
 * title-safe area and the other boxes, with guides while it does. The arrow
 * keys move the selected box. Without `canEdit` the scene is only drawn: no
 * boxes to move or resize.
 */
export function OverlayLayoutCanvas({
  elements,
  shown,
  selected,
  canEdit = true,
  projection,
  off,
  bar = true,
  caption,
  safeAreas,
  onSafeAreas,
  onSelect,
  onChange,
}: {
  elements: LiveOverlayLayoutElements;
  /** The graphics the scene shows, front first. */
  shown: readonly LiveOverlayElement[];
  selected: LiveOverlayElement | null;
  /** Whether the boxes are drawn, to move and resize the graphics. */
  canEdit?: boolean;
  /** The room to draw: the studio's Preview. Without it, a sample room with every graphic on. */
  projection?: LiveRoomState;
  /** Which of the scene's graphics have nothing on air, drawn as outlines; none in the sample room. */
  off?: (element: LiveOverlayElement) => boolean;
  /** Whether the hint and the safe-area switch sit above the canvas. */
  bar?: boolean;
  /** What the canvas says under it; the sample room's note when it draws one. */
  caption?: ComponentChildren;
  /** Whether the action-safe and title-safe guides are drawn. */
  safeAreas: boolean;
  onSafeAreas: (shown: boolean) => void;
  onSelect: (element: LiveOverlayElement) => void;
  onChange: (element: LiveOverlayElement, box: Box) => void;
}) {
  const help = useId();
  const sample = useMemo(() => (projection ? null : sampleOverlayRoom(Date.now())), [projection]);
  const room = projection ?? sample!;
  const gesture = useOverlayLayoutGesture(
    elements,
    (moving) => shown.filter((element) => element !== moving).map((element) => elements[element]),
    onChange,
  );
  const places = layoutLabelPlaces(elements, shown, LIVE_OVERLAY_ELEMENT_LABELS, safeAreas ? SAFE_AREA_LABELS : []);
  return (
    <figure class="pk-layout-canvas-figure">
      {bar ? (
        <div class="pk-layout-canvas__bar">
          <p class="pk-small pk-muted">
            {canEdit ? "1920 × 1080 · drag to move, drag a corner to resize" : "1920 × 1080"}
          </p>
          <Checkbox
            label="Show safe areas"
            checked={safeAreas}
            onChange={(event) => onSafeAreas(event.currentTarget.checked)}
          />
        </div>
      ) : null}
      <div class="pk-layout-canvas" ref={gesture.canvas}>
        <span class="pk-layout-canvas__camera" aria-hidden="true">
          Camera
        </span>
        <LiveOverlayPresentation view="program" elements={elements} projection={room} />
        <div class="pk-layout-canvas__guide" data-axis="vertical" ref={gesture.verticalGuide} aria-hidden="true" />
        <div class="pk-layout-canvas__guide" data-axis="horizontal" ref={gesture.horizontalGuide} aria-hidden="true" />
        {canEdit ? (
          <div class="pk-layout-canvas__boxes" role="group" aria-label={LAYOUT_CANVAS_LABEL}>
            {/* Back to front, as the outputs stack them; the selected box's outline and corners draw over every box. */}
            {[...shown].reverse().map((element) => (
              <LayoutBox
                key={element}
                element={element}
                box={elements[element]}
                selected={element === selected}
                off={off?.(element) ?? false}
                labelPlace={places[element] ?? { side: "top", along: 0 }}
                describedBy={help}
                cell={gesture.register(element)}
                handlers={gesture.handlers}
                onSelect={() => onSelect(element)}
                onNudge={(box) => onChange(element, box)}
              />
            ))}
          </div>
        ) : null}
        {/* Over the graphics and their boxes, so the margins show wherever something reaches into them. */}
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
      </div>
      {caption === undefined ? (
        <figcaption class="pk-small pk-muted">
          Sample content with every graphic on. Where graphics share a spot, the front one shows. Graphics keep clear of
          the ticker while it is on; with the ticker off, they use the full height.
        </figcaption>
      ) : caption ? (
        <figcaption class="pk-small pk-muted">{caption}</figcaption>
      ) : null}
      {canEdit ? (
        <p id={help} class="pk-sr-only">
          Arrow keys move the selected box by one pixel, Shift and an arrow key by 24. Hold Alt while dragging to place
          it without snapping.
        </p>
      ) : null}
    </figure>
  );
}
