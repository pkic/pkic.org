import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import {
  liveOverlayPartialOverlaps,
  liveOverlaySpotOf,
  liveOverlaySpotTurns,
} from "../../../../../../../../shared/live-overlay-spots";
import type { LiveProgramLayer } from "../../../../../../../../shared/live-overlay-stacking";
import {
  LIVE_OVERLAY_ELEMENT_LABELS,
  type LiveOverlayElement,
  type LiveOverlayLayoutElements,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { IconPlus } from "../../../../../../../components/icons";
import { usePointerDragSession } from "../../../../../../../hooks/usePointerDragSession";
import { Button } from "../../../../../../../ui/Button";
import { buttonClasses } from "../../../../../../../ui/button-classes";
import { EmptyState } from "../../../../../../../ui/EmptyState";
import { Menu } from "../../../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { IconChevron, StrokeIcon } from "../../../../../../../ui/MediaIcons";
import { RowActions } from "../../../../../../../ui/RowActions";
import { OverlayLayoutGraphicSwitch } from "./OverlayLayoutGraphicSwitch";
import { graphicActions, graphicNames, type GraphicActionHandlers } from "./overlay-layout-graphic-actions";
import { LAYOUT_GRAPHIC_DESCRIPTIONS } from "./overlay-layout-copy";
import { addableGraphics, describeGraphicPosition, sceneGraphics } from "./overlay-layout-graphics";
import "./OverlayLayouts.css";

/** A padlock, open while what it holds can be changed: Preview's scene, or a graphic's box on the canvas. */
export function LockIcon({ open }: { open: boolean }) {
  return (
    <StrokeIcon>
      <rect x="3" y="7" width="10" height="7" rx="1" />
      <path d={open ? "M5.5 7V4.8a2.5 2.5 0 0 1 4.9-.7" : "M5.5 7V4.8a2.5 2.5 0 0 1 5 0V7"} />
    </StrokeIcon>
  );
}

/** How a graphic's spot shows its boards, in a few words for its row; null when it has its box to itself. */
function spotWords(elements: LiveOverlayLayoutElements, element: LiveProgramLayer): string | null {
  const spot = liveOverlaySpotOf(elements, element);
  if (!spot) return null;
  const turns = liveOverlaySpotTurns(elements, spot);
  return turns ? `Takes turns, ${turns} s` : spot[0] === element ? "Shows in front" : "Behind in its spot";
}

/** Two boards that partly overlap, said once under the list: put them in one spot, or apart. */
function OverlapNote({ elements }: { elements: LiveOverlayLayoutElements }) {
  const overlaps = liveOverlayPartialOverlaps(elements);
  if (overlaps.length === 0) return null;
  return (
    <ul class="pk-scenes__overlaps" aria-label="Graphics that partly overlap">
      {overlaps.map(([front, back]) => (
        <li key={`${front}:${back}`}>
          {graphicNames([front])} partly covers {graphicNames([back])}. Drop it on {graphicNames([back])} to share one
          spot, or move it apart.
        </li>
      ))}
    </ul>
  );
}

/** A press on a grip becomes a drag once the pointer travels this far. */
const DRAG_THRESHOLD_PX = 3;

interface RowDrag {
  element: LiveProgramLayer;
  pointer: number;
  startY: number;
  started: boolean;
  frame: number | null;
  target: number;
}

/**
 * Reordering the list by its grips: the row follows the pointer to the place
 * it would land, shown as a line, and lands there on release; Escape puts it
 * back. Each row's Move up and Move down buttons do the same from the keyboard.
 */
function useRowDrag(rows: () => HTMLElement[], onReorder: (element: LiveProgramLayer, to: number) => void) {
  const drag = useRef<RowDrag | null>(null);
  const [shown, setShown] = useState<{ element: LiveProgramLayer; target: number } | null>(null);
  const finish = (commit: boolean) => {
    const active = drag.current;
    drag.current = null;
    setShown(null);
    if (active?.started && commit) onReorder(active.element, active.target);
  };
  const { release, cancel } = usePointerDragSession(drag, finish);
  const grip = (element: LiveProgramLayer, index: number) => ({
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      drag.current = {
        element,
        pointer: event.pointerId,
        startY: event.clientY,
        started: false,
        frame: null,
        target: index,
      };
    },
    onPointerMove: (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointer !== event.pointerId) return;
      if (!active.started && Math.abs(event.clientY - active.startY) < DRAG_THRESHOLD_PX) return;
      active.started = true;
      // The place is the number of other rows whose middle the pointer has passed.
      const middles = rows().map((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      active.target = middles.filter((middle, at) => at !== index && event.clientY > middle).length;
      setShown({ element, target: active.target });
    },
    onPointerUp: release,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  });
  return { shown, grip };
}

/** The Graphics panel around the scene's rows, the same for someone who changes the scene and someone who reads it. */
function GraphicsPanel({
  toolbar,
  empty,
  children,
}: {
  toolbar?: ComponentChildren;
  empty: boolean;
  children: ComponentChildren;
}) {
  return (
    <Panel class="pk-scenes__graphics">
      <PanelHeader title="Graphics" headingLevel={4}>
        {toolbar}
      </PanelHeader>
      <PanelBody flush>
        <p class="pk-scenes__note">Top of the list is drawn in front.</p>
        {empty ? (
          <div class="pk-scenes__empty">
            <EmptyState title="This scene shows no graphics yet." />
          </div>
        ) : (
          children
        )}
        <p class="pk-scenes__note">
          Content comes from the room live: which timer, which question, the current top questions.
        </p>
      </PanelBody>
    </Panel>
  );
}

/** A graphic's name, where it sits on the frame, and how its spot shows it when it shares one. */
function GraphicLabel({ element, elements }: { element: LiveProgramLayer; elements: LiveOverlayLayoutElements }) {
  const spot = spotWords(elements, element);
  return (
    <>
      <span class="pk-scenes__name">{LIVE_OVERLAY_ELEMENT_LABELS[element]}</span>
      <span class="pk-scenes__meta">
        {describeGraphicPosition(elements[element])}
        {spot ? ` · ${spot}` : null}
      </span>
    </>
  );
}

/**
 * The scene's graphics for someone who may not change the scene: what it
 * contains, front first, where each sits and what puts it on. Nothing to
 * press.
 */
export function OverlayLayoutGraphicsSummary({ elements }: { elements: LiveOverlayLayoutElements }) {
  const graphics = sceneGraphics(elements);
  return (
    <GraphicsPanel empty={graphics.length === 0}>
      <ul class="pk-scenes__rows" aria-label="Graphics in this scene">
        {graphics.map((element) => (
          <li key={element} class="pk-scenes__row" data-element={element}>
            <span class="pk-scenes__label">
              <GraphicLabel element={element} elements={elements} />
            </span>
            <OverlayLayoutGraphicSwitch element={element} placement={elements[element]} />
          </li>
        ))}
      </ul>
    </GraphicsPanel>
  );
}

/** Adds one of the Program graphics the scene does not show yet, at its shared position. */
export function AddGraphicMenu({
  elements,
  disabled,
  onShow,
}: {
  elements: LiveOverlayLayoutElements;
  disabled: boolean;
  onShow: (element: LiveOverlayElement, visible: boolean) => void;
}) {
  const addable = addableGraphics(elements);
  return (
    <Menu
      label="Add graphic"
      variant="plain"
      align="end"
      triggerClass={buttonClasses({ variant: "secondary" }, undefined)}
      disabled={disabled || addable.length === 0}
      items={addable.map((element) => ({
        id: element,
        label: LIVE_OVERLAY_ELEMENT_LABELS[element],
        description: LAYOUT_GRAPHIC_DESCRIPTIONS[element],
        onSelect: () => onShow(element, true),
      }))}
    >
      <IconPlus />
      Add graphic
    </Menu>
  );
}

/**
 * The scene's graphics, front first, the background among them: each row
 * picks its box on the canvas, says where it sits and what puts it on, and
 * moves it up or down the stack. A graphic that fills itself from the room
 * carries the scene's choice there: it comes on with the scene, or it is
 * switched in the studio. Add graphic offers the ones the scene does not show
 * yet; a row's menu decides whether it shares its position, or removes it.
 */
export function OverlayLayoutGraphics({
  elements,
  selected,
  disabled,
  onSelect,
  onShow,
  onComesOn,
  onReorder,
  onSharing,
  onTurns,
  onLock,
  onQrLook,
  framed = true,
}: {
  elements: LiveOverlayLayoutElements;
  selected: LiveOverlayElement | null;
  disabled: boolean;
  /** In its own Graphics panel with Add graphic; without, only the rows, for a host that has its own toolbar. */
  framed?: boolean;
  onSelect: (element: LiveOverlayElement) => void;
  /** Shows a graphic in the scene, or removes it. */
  onShow: (element: LiveOverlayElement, visible: boolean) => void;
  /** Sets whether a graphic that fills itself from the room comes on with the scene. */
  onComesOn: (element: LiveOverlayElement, comesOn: boolean) => void;
  onReorder: (element: LiveProgramLayer, to: number) => void;
  onSharing: GraphicActionHandlers["onSharing"];
  /** Lets the graphic's spot take turns every `turns` seconds, or show only its front graphic (null). */
  onTurns: GraphicActionHandlers["onTurns"];
  onQrLook: GraphicActionHandlers["onQrLook"];
  /** Holds the graphic's box in place on the canvas, or frees it. */
  onLock: (element: LiveOverlayElement, locked: boolean) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const graphics = sceneGraphics(elements);
  const drag = useRowDrag(() => [...(list.current?.children ?? [])] as HTMLElement[], onReorder);
  const handlers = { onShow, onSharing, onTurns, onQrLook };
  // While a row is dragged, the line shows where it lands: above the row now at that place, or below the last.
  const dropAt = (index: number) => {
    const shown = drag.shown;
    if (!shown || shown.element === graphics[index]) return undefined;
    const from = graphics.indexOf(shown.element);
    if (shown.target === index && shown.target < from) return "before";
    if (shown.target === index && shown.target > from) return "after";
    return undefined;
  };
  const rows = (
    <ul class="pk-scenes__rows" ref={list} aria-label="Graphics in this scene">
      {graphics.map((element, index) => {
        const label = LIVE_OVERLAY_ELEMENT_LABELS[element];
        return (
          <li
            key={element}
            class="pk-scenes__row"
            data-element={element}
            data-selected={element === selected ? "" : undefined}
            data-dragging={drag.shown?.element === element ? "" : undefined}
            data-drop={dropAt(index)}
          >
            <span
              class="pk-scenes__grip"
              aria-hidden="true"
              title={"Drag to reorder\nThe top of the list is drawn in front."}
              {...drag.grip(element, index)}
            >
              ⠿
            </span>
            <button
              type="button"
              class="pk-scenes__pick"
              aria-pressed={element === selected}
              onClick={() => onSelect(element)}
            >
              <GraphicLabel element={element} elements={elements} />
            </button>
            <OverlayLayoutGraphicSwitch
              element={element}
              placement={elements[element]}
              disabled={disabled}
              onComesOn={(comesOn) => onComesOn(element, comesOn)}
            />
            <span class="pk-scenes__moves">
              <Button
                icon
                variant="ghost"
                aria-label={`Move ${label} up`}
                title={`Move ${label} up\nOne step toward the front.`}
                disabled={disabled || index === 0}
                onClick={() => onReorder(element, index - 1)}
              >
                <IconChevron pointing="up" />
              </Button>
              <Button
                icon
                variant="ghost"
                aria-label={`Move ${label} down`}
                title={`Move ${label} down\nOne step toward the back.`}
                disabled={disabled || index === graphics.length - 1}
                onClick={() => onReorder(element, index + 1)}
              >
                <IconChevron pointing="down" />
              </Button>
            </span>
            <Button
              icon
              variant="ghost"
              aria-pressed={elements[element].locked === true}
              aria-label={elements[element].locked ? `Unlock ${label}` : `Lock ${label}`}
              title={
                elements[element].locked
                  ? `Unlock ${label}\nLets you drag it on the canvas again.`
                  : `Lock ${label}\nHolds it in place on the canvas, so a press reaches the graphic behind it.`
              }
              disabled={disabled}
              onClick={() => onLock(element, !elements[element].locked)}
            >
              <LockIcon open={!elements[element].locked} />
            </Button>
            <RowActions
              subject={label}
              hint="Share or keep its position across scenes, set how its spot shows it, or remove it."
              actions={graphicActions(elements, element, disabled, handlers)}
            />
          </li>
        );
      })}
    </ul>
  );
  if (!framed)
    return (
      <>
        {rows}
        <OverlapNote elements={elements} />
      </>
    );
  return (
    <GraphicsPanel
      empty={graphics.length === 0}
      toolbar={<AddGraphicMenu elements={elements} disabled={disabled} onShow={onShow} />}
    >
      {rows}
      <OverlapNote elements={elements} />
    </GraphicsPanel>
  );
}
