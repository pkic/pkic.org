/**
 * ListDetail — an editor for an ordered list of things: compact rows on one
 * side, the selected row's fields on the other. It scales to many items where
 * a stack of full forms does not, and keeps ordering explicit: each row moves
 * up or down by its own labeled buttons, which work from the keyboard.
 *
 * The caller owns the items and their order; this component only lays them
 * out, reports selection and moves, and shows the detail it is given.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "./Button";
import { IconChevron } from "./MediaIcons";
import "./ListDetail.css";

export interface ListDetailItem {
  id: string;
  /** The row's name, one line. */
  label: string;
  /** A second, quieter line: what the item says or when it applies. */
  detail?: string;
  /** Names a problem in this item, such as a field the contract refused. */
  attention?: string;
}

export function ListDetail({
  items,
  selectedId,
  onSelect,
  onMove,
  listLabel,
  addAction,
  children,
}: {
  items: readonly ListDetailItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Moves an item one place; omit for a list whose order is fixed. */
  onMove?: (id: string, direction: -1 | 1) => void;
  /** Names the list for assistive technology, e.g. "Ticker messages". */
  listLabel: string;
  /** The control that adds an item, under the list. */
  addAction?: ComponentChildren;
  /** The selected item's fields. */
  children: ComponentChildren;
}) {
  const list = useRef<HTMLOListElement>(null);
  // The selected row stays in view, whether it was just added, moved or picked.
  const position = items.findIndex((item) => item.id === selectedId);
  useEffect(() => {
    list.current?.querySelector("[data-selected]")?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId, position]);
  return (
    <div class="pk-list-detail">
      <div class="pk-list-detail__list">
        <ol ref={list} class="pk-list-detail__items" aria-label={listLabel}>
          {items.map((item, index) => {
            const selected = item.id === selectedId;
            return (
              <li key={item.id} class="pk-list-detail__item" data-selected={selected ? "" : undefined}>
                <button
                  type="button"
                  class="pk-list-detail__select"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <span class="pk-list-detail__label">{item.label}</span>
                  {item.detail ? <span class="pk-list-detail__detail">{item.detail}</span> : null}
                  {item.attention ? <span class="pk-list-detail__attention">{item.attention}</span> : null}
                </button>
                {onMove ? (
                  <span class="pk-list-detail__moves">
                    <Button
                      icon
                      variant="ghost"
                      aria-label={`Move ${item.label} up`}
                      title="Move up"
                      disabled={index === 0}
                      onClick={() => onMove(item.id, -1)}
                    >
                      <IconChevron pointing="up" />
                    </Button>
                    <Button
                      icon
                      variant="ghost"
                      aria-label={`Move ${item.label} down`}
                      title="Move down"
                      disabled={index === items.length - 1}
                      onClick={() => onMove(item.id, 1)}
                    >
                      <IconChevron pointing="down" />
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {addAction ? <div class="pk-list-detail__add">{addAction}</div> : null}
      </div>
      <div class="pk-list-detail__detail-pane">{children}</div>
    </div>
  );
}
