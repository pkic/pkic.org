import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
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
import { Menu, type MenuItem } from "../../../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { IconChevron } from "../../../../../../../ui/MediaIcons";
import { RowActions } from "../../../../../../../ui/RowActions";
import { OverlayLayoutGraphicSwitch } from "./OverlayLayoutGraphicSwitch";
import { LAYOUT_GRAPHIC_DESCRIPTIONS } from "./overlay-layout-copy";
import { addableGraphics, describeGraphicPosition, sceneGraphics } from "./overlay-layout-graphics";

/** What a row's menu does to a graphic's position: see `overlay-layout-sharing.ts`. */
export type LayoutSharingAction = "unlink" | "relink" | "apply";

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

/** A graphic's name and where it sits on the frame. */
function GraphicLabel({ element, elements }: { element: LiveProgramLayer; elements: LiveOverlayLayoutElements }) {
  return (
    <>
      <span class="pk-scenes__name">{LIVE_OVERLAY_ELEMENT_LABELS[element]}</span>
      <span class="pk-scenes__meta">{describeGraphicPosition(elements[element])}</span>
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
}: {
  elements: LiveOverlayLayoutElements;
  selected: LiveOverlayElement | null;
  disabled: boolean;
  onSelect: (element: LiveOverlayElement) => void;
  /** Shows a graphic in the scene, or removes it. */
  onShow: (element: LiveOverlayElement, visible: boolean) => void;
  /** Sets whether a graphic that fills itself from the room comes on with the scene. */
  onComesOn: (element: LiveOverlayElement, comesOn: boolean) => void;
  onReorder: (element: LiveProgramLayer, to: number) => void;
  onSharing: (element: LiveOverlayElement, action: LayoutSharingAction) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const graphics = sceneGraphics(elements);
  const addable = addableGraphics(elements);
  const drag = useRowDrag(() => [...(list.current?.children ?? [])] as HTMLElement[], onReorder);
  const actions = (element: LiveProgramLayer): MenuItem[] => [
    ...(elements[element].shared
      ? [
          {
            id: "unlink",
            label: "Place differently on this scene",
            tooltip: "Gives this scene its own position for the graphic. The other scenes keep the shared one.",
            disabled,
            onSelect: () => onSharing(element, "unlink"),
          },
        ]
      : [
          {
            id: "relink",
            label: "Use shared position",
            tooltip: "Drops this scene's own position and takes the one the scenes share.",
            disabled,
            onSelect: () => onSharing(element, "relink"),
          },
          {
            id: "apply",
            label: "Apply this position to all scenes",
            tooltip: "Makes this position the shared one, so every scene that shares it follows.",
            disabled,
            onSelect: () => onSharing(element, "apply"),
          },
        ]),
    {
      id: "remove",
      label: "Remove from scene",
      danger: true,
      separatorBefore: true,
      disabled,
      onSelect: () => onShow(element, false),
    },
  ];
  // While a row is dragged, the line shows where it lands: above the row now at that place, or below the last.
  const dropAt = (index: number) => {
    const shown = drag.shown;
    if (!shown || shown.element === graphics[index]) return undefined;
    const from = graphics.indexOf(shown.element);
    if (shown.target === index && shown.target < from) return "before";
    if (shown.target === index && shown.target > from) return "after";
    return undefined;
  };
  return (
    <GraphicsPanel
      empty={graphics.length === 0}
      toolbar={
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
      }
    >
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
              <RowActions
                subject={label}
                hint="Share or keep its position across scenes, or remove it from this scene."
                actions={actions(element)}
              />
              <OverlayLayoutGraphicSwitch
                element={element}
                placement={elements[element]}
                disabled={disabled}
                onComesOn={(comesOn) => onComesOn(element, comesOn)}
              />
            </li>
          );
        })}
      </ul>
    </GraphicsPanel>
  );
}
