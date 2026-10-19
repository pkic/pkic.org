import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Checkbox } from "../../../../../../../ui/Checkbox";
import { layoutLabelSides, readSafeAreasPreference, saveSafeAreasPreference } from "./overlay-layout-labels";
import {
  LIVE_OVERLAY_ELEMENTS,
  LIVE_OVERLAY_ELEMENT_COMPOSITIONS,
  LIVE_OVERLAY_ELEMENT_LABELS,
  type LiveOverlayComposition,
  type LiveOverlayElement,
  type LiveOverlayLayoutElements,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { LiveOverlayPresentation } from "../../../../../../../live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { LAYOUT_LAYER_LABEL } from "./overlay-layout-copy";
import { RESIZE_HANDLES, nudgeBox, type Box } from "./overlay-layout-editing";
import { placeLayoutBox, useOverlayLayoutGesture } from "./useOverlayLayoutGesture";
import "./OverlayLayoutCanvas.css";

const ARROWS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;

/** One element's box on the canvas, kept at its place through custom properties, never an inline style. */
function LayoutBox({
  element,
  box,
  visible,
  selected,
  labelSide,
  describedBy,
  cell,
  handlers,
  onSelect,
  onNudge,
}: {
  element: LiveOverlayElement;
  box: Box;
  visible: boolean;
  selected: boolean;
  /** Where the label sits so it never covers another box's label. */
  labelSide: "top" | "bottom";
  describedBy: string;
  cell: (node: HTMLElement | null) => void;
  handlers: ReturnType<typeof useOverlayLayoutGesture>["handlers"];
  onSelect: () => void;
  onNudge: (box: Box) => void;
}) {
  const node = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (node.current) placeLayoutBox(node.current, box);
  }, [box.x, box.y, box.w, box.h]);
  const label = LIVE_OVERLAY_ELEMENT_LABELS[element];
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
      data-hidden={visible ? undefined : ""}
      data-label={labelSide}
      aria-pressed={selected}
      aria-label={`${label}${visible ? "" : " (hidden)"}: ${percent(box.x)} from left, ${percent(box.y)} from top, ${percent(box.w)} wide, ${percent(box.h)} high`}
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
        // Pressing a box picks it, so the inspector follows the box being dragged.
        onSelect();
        move.onPointerDown(event);
      }}
    >
      <span class="pk-layout-canvas__label" aria-hidden="true">
        {label}
      </span>
      {selected
        ? RESIZE_HANDLES.map((handle) => (
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
 * The layout on a 16:9 canvas: a sample room drawn by the real overlay, with
 * each element's box over it. Drag a box to move it, a handle to resize it;
 * it snaps to the grid, the title-safe area and the other boxes, with guides
 * while it does. The arrow keys move the selected box.
 */
export function OverlayLayoutCanvas({
  elements,
  composition,
  room,
  selected,
  onSelect,
  onChange,
}: {
  elements: LiveOverlayLayoutElements;
  composition: LiveOverlayComposition;
  room: LiveRoomState;
  selected: LiveOverlayElement;
  onSelect: (element: LiveOverlayElement) => void;
  onChange: (element: LiveOverlayElement, box: Box) => void;
}) {
  const help = useId();
  const [allSamples, setAllSamples] = useState(false);
  const [safeAreas, setSafeAreas] = useState(readSafeAreasPreference);
  const shown = LIVE_OVERLAY_ELEMENTS.filter((element) =>
    LIVE_OVERLAY_ELEMENT_COMPOSITIONS[element].includes(composition),
  );
  const gesture = useOverlayLayoutGesture(
    elements,
    (moving) =>
      shown.filter((element) => element !== moving && elements[element].visible).map((element) => elements[element]),
    onChange,
  );
  const sides = layoutLabelSides(elements, shown, LIVE_OVERLAY_ELEMENT_LABELS);
  return (
    <figure class="pk-layout-canvas-figure">
      <div class="pk-layout-canvas__options">
        <Checkbox
          label="Show all samples"
          checked={allSamples}
          onChange={(event) => setAllSamples(event.currentTarget.checked)}
        />
        <Checkbox
          label="Safe areas"
          checked={safeAreas}
          onChange={(event) => {
            setSafeAreas(event.currentTarget.checked);
            saveSafeAreasPreference(event.currentTarget.checked);
          }}
        />
      </div>
      <div class="pk-layout-canvas" ref={gesture.canvas} data-composition={composition}>
        <LiveOverlayPresentation
          view={composition === "stage-display" ? "stage-display" : "program"}
          elements={elements}
          projection={room}
          focus={allSamples ? null : selected}
        />
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
        <div class="pk-layout-canvas__boxes" role="group" aria-label={LAYOUT_LAYER_LABEL[composition]}>
          {/* Larger boxes underneath, so a small one inside them stays reachable; the stylesheet lifts the selected one. */}
          {[...shown]
            .sort((a, b) => elements[b].w * elements[b].h - elements[a].w * elements[a].h)
            .map((element) => (
              <LayoutBox
                key={element}
                element={element}
                box={elements[element]}
                visible={elements[element].visible}
                selected={element === selected}
                labelSide={sides[element]}
                describedBy={help}
                cell={gesture.register(element)}
                handlers={gesture.handlers}
                onSelect={() => onSelect(element)}
                onNudge={(box) => onChange(element, box)}
              />
            ))}
        </div>
      </div>
      <figcaption id={help} class="pk-small pk-muted">
        Drag a box to move it and its edges to resize it. Arrow keys move the selected box by one pixel, Shift and an
        arrow key by 24. Hold Alt while dragging to place it without snapping.
      </figcaption>
    </figure>
  );
}
