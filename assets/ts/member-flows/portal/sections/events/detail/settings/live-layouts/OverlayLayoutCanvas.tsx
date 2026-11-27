import type { ComponentChildren } from "preact";
import { useId, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { LiveOverlayPresentation } from "../../../../../../../live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { Checkbox } from "../../../../../../../ui/Checkbox";
import { Menu, type MenuHandle, type MenuItem } from "../../../../../../../ui/Menu";
import { SAFE_AREA_LABELS, layoutLabelPlaces, type LabelPlace } from "./overlay-layout-labels";
import {
  LIVE_OVERLAY_ELEMENT_LABELS,
  type LiveOverlayElement,
  type LiveOverlayLayoutElements,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { LAYOUT_CANVAS_LABEL } from "./overlay-layout-copy";
import { BOX_HANDLES, nudgeBox, type Box } from "./overlay-layout-editing";
import { describeGraphicPosition } from "./overlay-layout-graphics";
import { sampleOverlayRoom } from "./overlay-layout-sample";
import { LayoutSnapToggle } from "./LayoutSnapToggle";
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
  locked,
  labelPlace,
  describedBy,
  cell,
  handlers,
  heldBelow,
  wasDragged,
  onSelect,
  onNudge,
}: {
  element: LiveOverlayElement;
  box: Box;
  selected: boolean;
  /** The graphic is in the scene but has nothing on air: its box is an outline with its name. */
  off: boolean;
  /** Held in place: it is not moved here, and a press passes through it to the box behind. */
  locked: boolean;
  /** Where its name sits along its top or bottom edge, clear of every other name. */
  labelPlace: LabelPlace;
  describedBy: string;
  cell: (node: HTMLElement | null) => void;
  handlers: ReturnType<typeof useOverlayLayoutGesture>["handlers"];
  /** The selected box when it lies under this one and can move: a drag from here moves it instead. */
  heldBelow: { element: LiveOverlayElement; box: Box } | null;
  wasDragged: () => boolean;
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
      data-locked={locked ? "" : undefined}
      data-label-side={labelPlace.side}
      aria-pressed={selected}
      aria-label={`${label}${off ? " (off)" : ""}, ${position}: ${percent(box.x)} from left, ${percent(box.y)} from top, ${percent(box.w)} wide, ${percent(box.h)} high`}
      aria-describedby={describedBy}
      title={
        locked
          ? `${label} · ${position}\nLocked. Unlock it in the graphics list to move it here.`
          : `${label} · ${position}\nDrag to move it, or a corner or side to resize it. The arrow keys move it too.`
      }
      onFocus={onSelect}
      onClick={() => {
        if (!wasDragged()) onSelect();
      }}
      onKeyDown={(event) => {
        const direction = ARROWS[event.key];
        if (!direction || locked) return;
        event.preventDefault();
        onNudge(nudgeBox(box, direction, event.shiftKey));
      }}
      {...move}
      onPointerDown={(event: PointerEvent) => {
        // A drag inside the selected box moves it, even where this box lies in front; a click still picks this one.
        if (heldBelow && pressedInside(event, heldBelow.box)) {
          // Not focused either, which would pick this box before the drag shows it was not meant.
          event.preventDefault();
          handlers("move", heldBelow.element).onPointerDown(event);
          return;
        }
        // Pressing a box picks it, so the list and the exact position follow the box being dragged.
        onSelect();
        move.onPointerDown(event);
      }}
    >
      <span class="pk-layout-canvas__label" aria-hidden="true">
        <span class="pk-layout-canvas__name">{label}</span>
        {selected ? <span class="pk-layout-canvas__detail"> · {position}</span> : null}
      </span>
      {selected && !locked
        ? BOX_HANDLES.map((handle) => (
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
 * The selected graphic's menu, at its box's top right corner; a right click on
 * any box picks it and opens this menu at the pointer.
 */
function BoxActions({
  element,
  box,
  items,
  menu,
}: {
  element: LiveOverlayElement;
  box: Box;
  items: readonly MenuItem[];
  menu: { current: MenuHandle | null };
}) {
  const node = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (node.current) placeLayoutBox(node.current, box);
  }, [box]);
  const label = LIVE_OVERLAY_ELEMENT_LABELS[element];
  return (
    <span class="pk-layout-canvas__actions" ref={node}>
      <Menu
        label={`${label} actions`}
        title={`${label} actions\nRight-click a graphic for these too.`}
        align="end"
        items={items}
        menuRef={menu}
      />
    </span>
  );
}

/**
 * The scene on a 16:9 canvas, drawn by the renderer the outputs use with a
 * sample room that has every graphic on, whatever puts it on in the studio,
 * and a box over each graphic the scene includes. Boxes are stacked
 * as the outputs draw them, so a graphic in front covers the ones behind it.
 * Drag a box to move it, a corner or side to resize it; while snapping is
 * on it snaps to the grid, the title-safe area and the other boxes, with
 * guides while it does. The arrow
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
  actions,
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
  /** A box moved: dropped (`joinsSpot` unless Alt was held) or nudged by the arrow keys, which never join a spot. */
  onChange: (element: LiveOverlayElement, box: Box, joinsSpot?: boolean) => boolean | void;
  /** A graphic's menu, on its box and on a right click; without it, neither. */
  actions?: (element: LiveOverlayElement) => readonly MenuItem[];
}) {
  const menu = useRef<MenuHandle>(null);
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
            {canEdit ? "1920 × 1080 · drag to move, drag a corner or side to resize" : "1920 × 1080"}
          </p>
          <Checkbox
            label="Show safe areas"
            checked={safeAreas}
            onChange={(event) => onSafeAreas(event.currentTarget.checked)}
          />
          {canEdit ? <LayoutSnapToggle /> : null}
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
          <div
            class="pk-layout-canvas__boxes"
            role="group"
            aria-label={LAYOUT_CANVAS_LABEL}
            onContextMenu={(event) => {
              // The smallest graphic under the pointer, so one inside a large box is still reachable.
              const box = smallestBoxAt(event.clientX, event.clientY);
              const element = box?.dataset.element as LiveOverlayElement | undefined;
              // Shift keeps the browser's own menu.
              if (!actions || !box || !element || event.shiftKey) return;
              event.preventDefault();
              onSelect(element);
              menu.current?.openAt({ x: event.clientX, y: event.clientY }, box);
            }}
          >
            {/* Back to front, as the outputs stack them; the selected box's outline and corners draw over every box. */}
            {[...shown].reverse().map((element) => (
              <LayoutBox
                key={element}
                element={element}
                box={elements[element]}
                selected={element === selected}
                off={off?.(element) ?? false}
                locked={elements[element].locked === true}
                labelPlace={places[element] ?? { side: "top", along: 0 }}
                describedBy={help}
                cell={gesture.register(element)}
                handlers={gesture.handlers}
                heldBelow={
                  selected && selected !== element && shown.includes(selected) && !elements[selected].locked
                    ? { element: selected, box: elements[selected] }
                    : null
                }
                wasDragged={gesture.wasDragged}
                onSelect={() => onSelect(element)}
                onNudge={(box) => onChange(element, box)}
              />
            ))}
            {actions && selected && shown.includes(selected) ? (
              <BoxActions element={selected} box={elements[selected]} items={actions(selected)} menu={menu} />
            ) : null}
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
          Sample content with every graphic on. Where graphics share a spot, the front one shows, or they take turns.
          Graphics keep clear of the ticker while it is on; with the ticker off, they use the full height.
        </figcaption>
      ) : caption ? (
        <figcaption class="pk-small pk-muted">{caption}</figcaption>
      ) : null}
      {canEdit ? (
        <p id={help} class="pk-sr-only">
          Arrow keys move the selected box by one pixel, Shift and an arrow key by 24. Snap turns snapping on or off;
          hold Alt while dragging to do the opposite.
        </p>
      ) : null}
    </figure>
  );
}

/** The smallest layout box under a point, or null. */
function smallestBoxAt(x: number, y: number): HTMLElement | null {
  const area = (box: HTMLElement) => box.offsetWidth * box.offsetHeight;
  const boxes = document
    .elementsFromPoint(x, y)
    .filter((node): node is HTMLElement => node instanceof HTMLElement && node.matches("[data-element]"));
  return boxes.reduce<HTMLElement | null>((best, box) => (!best || area(box) < area(best) ? box : best), null);
}

/** Whether a press on a box falls inside another box, both as fractions of the canvas the boxes sit on. */
function pressedInside(event: PointerEvent, box: Box): boolean {
  const area = (event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
  if (!area || area.width === 0 || area.height === 0) return false;
  const x = (event.clientX - area.left) / area.width;
  const y = (event.clientY - area.top) / area.height;
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}
