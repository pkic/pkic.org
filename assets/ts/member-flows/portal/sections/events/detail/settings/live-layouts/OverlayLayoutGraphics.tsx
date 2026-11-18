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
import { LAYOUT_FIELD_LABEL, LAYOUT_GRAPHIC_DESCRIPTIONS } from "./overlay-layout-copy";
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

/**
 * The scene's graphics, front first, the background among them: each row
 * picks its box on the canvas, says where it sits, and moves it up or down
 * the stack. Add graphic offers the ones the scene does not show yet; a row's
 * menu puts the graphic on the conference field, decides whether it shares
 * its position, or removes it.
 */
export function OverlayLayoutGraphics({
  elements,
  selected,
  disabled,
  onSelect,
  onField,
  onShow,
  onReorder,
  onSharing,
}: {
  elements: LiveOverlayLayoutElements;
  selected: LiveOverlayElement | null;
  disabled: boolean;
  onSelect: (element: LiveOverlayElement) => void;
  /** Puts the conference field behind a graphic, in its own box, or takes it away. */
  onField: (element: LiveOverlayElement, field: boolean) => void;
  /** Shows a graphic in the scene, or removes it. */
  onShow: (element: LiveOverlayElement, visible: boolean) => void;
  onReorder: (element: LiveProgramLayer, to: number) => void;
  onSharing: (element: LiveOverlayElement, action: LayoutSharingAction) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const graphics = sceneGraphics(elements);
  const addable = addableGraphics(elements);
  const drag = useRowDrag(() => [...(list.current?.children ?? [])] as HTMLElement[], onReorder);
  const actions = (element: LiveProgramLayer): MenuItem[] => [
    // The background is the field itself; every other graphic can carry one in its box.
    ...(element === "background"
      ? []
      : [
          {
            id: "field",
            label: LAYOUT_FIELD_LABEL,
            description: "Draws the conference field behind it, in its box",
            multiple: true,
            checked: elements[element].background === true,
            disabled,
            onSelect: () => onField(element, elements[element].background !== true),
          },
        ]),
    ...(elements[element].shared
      ? [
          {
            id: "unlink",
            label: "Place differently on this scene",
            separatorBefore: element !== "background",
            disabled,
            onSelect: () => onSharing(element, "unlink"),
          },
        ]
      : [
          {
            id: "relink",
            label: "Use shared position",
            separatorBefore: element !== "background",
            disabled,
            onSelect: () => onSharing(element, "relink"),
          },
          {
            id: "apply",
            label: "Apply this position to all scenes",
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
    <Panel class="pk-scenes__graphics">
      <PanelHeader title="Graphics" headingLevel={4}>
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
      </PanelHeader>
      <PanelBody flush>
        <p class="pk-scenes__note">Top of the list is drawn in front.</p>
        {graphics.length ? (
          <ul class="pk-scenes__rows" ref={list} aria-label="Graphics in this scene">
            {graphics.map((element, index) => {
              const label = LIVE_OVERLAY_ELEMENT_LABELS[element];
              const position = describeGraphicPosition(elements[element]);
              const onField = element !== "background" && elements[element].background === true;
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
                    title="Drag to reorder"
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
                    <span class="pk-scenes__name">{label}</span>
                    <span class="pk-scenes__meta">
                      {onField ? `${position} · ${LAYOUT_FIELD_LABEL.toLowerCase()}` : position}
                    </span>
                  </button>
                  <span class="pk-scenes__moves">
                    <Button
                      icon
                      variant="ghost"
                      aria-label={`Move ${label} up`}
                      title="Move up"
                      disabled={disabled || index === 0}
                      onClick={() => onReorder(element, index - 1)}
                    >
                      <IconChevron pointing="up" />
                    </Button>
                    <Button
                      icon
                      variant="ghost"
                      aria-label={`Move ${label} down`}
                      title="Move down"
                      disabled={disabled || index === graphics.length - 1}
                      onClick={() => onReorder(element, index + 1)}
                    >
                      <IconChevron pointing="down" />
                    </Button>
                  </span>
                  <RowActions subject={label} actions={actions(element)} />
                </li>
              );
            })}
          </ul>
        ) : (
          <div class="pk-scenes__empty">
            <EmptyState title="This scene shows no graphics yet." />
          </div>
        )}
        <p class="pk-scenes__note">
          Content comes from the room live: which timer, which question, the current top questions.
        </p>
      </PanelBody>
    </Panel>
  );
}
