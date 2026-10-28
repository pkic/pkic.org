import { useId, useRef, useState } from "preact/hooks";
import { Button } from "../../ui/Button";
import { formatNumber } from "../../../shared/format-number";

const sizeLabel = (columns: number, rows: number) =>
  `${formatNumber(columns)} column${columns === 1 ? "" : "s"} by ${formatNumber(rows)} row${rows === 1 ? "" : "s"}`;

/** A table-style sizing matrix supports pointer preview and roving arrow-key focus; selection inserts immediately. */
export function LayoutSizeGrid({
  columns,
  rows,
  label,
  onSelect,
}: {
  columns: number;
  rows: number;
  label: string;
  onSelect: (columns: number, rows: number) => void;
}) {
  const description = useId();
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ columns: 1, rows: 1 });
  return (
    <div ref={root} class="pk-layout-size" data-columns={columns}>
      <p id={description} class="pk-layout-size__caption" aria-live="polite">
        {sizeLabel(size.columns, size.rows)}
      </p>
      <div
        role="grid"
        aria-label={label}
        aria-describedby={description}
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return;
          const bounds = event.currentTarget.getBoundingClientRect();
          setSize({
            columns: Math.max(
              1,
              Math.min(columns, Math.floor(((event.clientX - bounds.left) / bounds.width) * columns) + 1),
            ),
            rows: Math.max(1, Math.min(rows, Math.floor(((event.clientY - bounds.top) / bounds.height) * rows) + 1)),
          });
        }}
      >
        {Array.from({ length: rows }, (_, y) => (
          <div role="row" class="pk-layout-size__row" key={y}>
            {Array.from({ length: columns }, (_, x) => {
              const active = size.columns === x + 1 && size.rows === y + 1;
              return (
                <Button
                  key={x}
                  variant="ghost"
                  class="pk-layout-size__cell"
                  role="gridcell"
                  aria-label={sizeLabel(x + 1, y + 1)}
                  aria-selected={active}
                  data-initial-focus={x === 0 && y === 0 ? "true" : undefined}
                  data-highlighted={x < size.columns && y < size.rows}
                  tabIndex={active ? 0 : -1}
                  onFocus={() => setSize({ columns: x + 1, rows: y + 1 })}
                  onKeyDown={(event) => {
                    let nextX = x,
                      nextY = y;
                    if (event.key === "ArrowRight") nextX++;
                    else if (event.key === "ArrowLeft") nextX--;
                    else if (event.key === "ArrowDown") nextY++;
                    else if (event.key === "ArrowUp") nextY--;
                    else if (event.key === "Home") {
                      nextX = 0;
                      if (event.ctrlKey) nextY = 0;
                    } else if (event.key === "End") {
                      nextX = columns - 1;
                      if (event.ctrlKey) nextY = rows - 1;
                    } else return;
                    event.preventDefault();
                    root.current
                      ?.querySelectorAll<HTMLButtonElement>('[role="gridcell"]')
                      [
                        Math.max(0, Math.min(rows - 1, nextY)) * columns + Math.max(0, Math.min(columns - 1, nextX))
                      ]?.focus();
                  }}
                  onClick={() => onSelect(x + 1, y + 1)}
                >
                  <span aria-hidden="true" />
                </Button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
