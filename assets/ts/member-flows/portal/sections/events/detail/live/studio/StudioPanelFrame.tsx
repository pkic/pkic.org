import type { ComponentChildren, Ref } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { CloseButton } from "../../../../../../../ui/CloseButton";
import { Menu, type MenuItem } from "../../../../../../../ui/Menu";
import { Panel } from "../../../../../../../ui/Panel";
import { SectionHeading } from "../../../../../../../ui/SectionHeading";
import {
  STUDIO_COLUMNS,
  STUDIO_MAX_H,
  canMoveStudioPanel,
  closeStudioPanel,
  moveStudioPanel,
  resizeStudioPanel,
  studioGridBounds,
  type StudioDirection,
  type StudioPanel,
} from "./studio-layout";
import { placeStudioCell } from "./useStudioGesture";
import type { GridEdge } from "./studio-grid";
import { useScrollEdges } from "./useScrollEdges";

/** The edges and corners a pointer resizes from; the bottom-right grip is also the keyboard's. */
const EDGES: readonly GridEdge[] = ["n", "e", "s", "w", "ne", "nw", "sw"];
import type { StudioChange } from "./useStudioLayout";

type PointerHandlers = {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onLostPointerCapture: (event: PointerEvent) => void;
};

const MOVES: ReadonlyArray<{ direction: StudioDirection; label: string }> = [
  { direction: "up", label: "Move up" },
  { direction: "down", label: "Move down" },
  { direction: "left", label: "Move left" },
  { direction: "right", label: "Move right" },
];

const RESIZE_KEYS: Record<string, { w?: number; h?: number }> = {
  ArrowRight: { w: 1 },
  ArrowLeft: { w: -1 },
  ArrowDown: { h: 1 },
  ArrowUp: { h: -1 },
};

/**
 * One panel of the studio grid. Its header is the drag handle, every edge
 * and corner resizes it, and its corner grip and menu do both from the
 * keyboard: dragging is never the only way to arrange the room.
 */
export function StudioPanelFrame({
  panel,
  panels,
  title,
  heading,
  actions,
  menu = [],
  change,
  defaultSize,
  cell,
  dragHandle,
  resizeHandle,
  children,
}: {
  panel: StudioPanel;
  panels: readonly StudioPanel[];
  /** The panel's name, for its controls: "Speakers", "Multiview". */
  title: string;
  /** Header content in place of the plain title, such as a monitor's output picker. */
  heading?: ComponentChildren;
  actions?: ComponentChildren;
  /** The panel's own choices, at the top of its menu above moving and sizing. */
  menu?: readonly MenuItem[];
  change: StudioChange;
  defaultSize: { w: number; h: number };
  cell: Ref<HTMLDivElement>;
  dragHandle: PointerHandlers;
  resizeHandle: (edge: GridEdge) => PointerHandlers;
  children: ComponentChildren;
}) {
  const node = useRef<HTMLDivElement | null>(null);
  const body = useScrollEdges<HTMLDivElement>();
  // The grid position is a runtime value, so it rides custom properties the stylesheet reads.
  useLayoutEffect(() => {
    if (node.current) placeStudioCell(node.current, panel);
  }, [panel.x, panel.y, panel.w, panel.h]);
  const resize = (size: { w?: number; h?: number }) => change((all) => resizeStudioPanel(all, panel.id, size));
  const bounds = studioGridBounds(panel.type);
  const items: MenuItem[] = [
    ...menu,
    ...MOVES.map(({ direction, label }, index) => ({
      id: direction,
      label,
      separatorBefore: index === 0 && menu.length > 0,
      disabled: !canMoveStudioPanel(panels, panel.id, direction),
      onSelect: () => change((all) => moveStudioPanel(all, panel.id, direction)),
    })),
    {
      id: "wider",
      label: "Wider",
      separatorBefore: true,
      disabled: panel.w >= STUDIO_COLUMNS,
      onSelect: () => resize({ w: panel.w + 1 }),
    },
    {
      id: "narrower",
      label: "Narrower",
      disabled: panel.w <= bounds.minW,
      onSelect: () => resize({ w: panel.w - 1 }),
    },
    { id: "taller", label: "Taller", disabled: panel.h >= STUDIO_MAX_H, onSelect: () => resize({ h: panel.h + 1 }) },
    { id: "shorter", label: "Shorter", disabled: panel.h <= bounds.minH, onSelect: () => resize({ h: panel.h - 1 }) },
    {
      id: "reset",
      label: "Reset size",
      disabled: panel.w === defaultSize.w && panel.h === defaultSize.h,
      onSelect: () => resize(defaultSize),
    },
  ];
  return (
    <div
      ref={(element) => {
        node.current = element;
        if (typeof cell === "function") cell(element);
      }}
      class="pk-studio-cell"
      data-presence-panel={panel.type}
    >
      <Panel class="pk-studio-panel" aria-label={title}>
        <header class="pk-studio-panel__header" title="Drag to move" {...dragHandle}>
          <span class="pk-studio-panel__grip" aria-hidden="true" />
          {heading ?? (
            <SectionHeading level={3} class="pk-studio-panel__title">
              {title}
            </SectionHeading>
          )}
          <span class="pk-studio-panel__actions">
            <Menu label={`${title} panel`} align="end" items={items} />
            {actions}
            <CloseButton label={`Close ${title}`} onClick={() => change((all) => closeStudioPanel(all, panel.id))} />
          </span>
        </header>
        <div ref={body} class="pk-studio-panel__body pk-scroll-edges">
          {children}
        </div>
      </Panel>
      <button
        type="button"
        class="pk-studio-cell__resize"
        aria-label={`Resize ${title}`}
        title="Drag to resize. Arrow keys resize too."
        onKeyDown={(event) => {
          const step = RESIZE_KEYS[event.key];
          if (!step) return;
          event.preventDefault();
          resize({ w: panel.w + (step.w ?? 0), h: panel.h + (step.h ?? 0) });
        }}
        {...resizeHandle("se")}
      />
      {EDGES.map((edge) => (
        <span key={edge} class="pk-studio-cell__edge" data-edge={edge} aria-hidden="true" {...resizeHandle(edge)} />
      ))}
    </div>
  );
}
