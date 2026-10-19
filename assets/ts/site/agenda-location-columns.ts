/** Public filtering compresses the existing table; editor geometry never changes. */
export function filterAgendaLocationColumns(panel: HTMLElement, selected: ReadonlySet<string | undefined>): void {
  for (const table of panel.querySelectorAll<HTMLTableElement>("[data-agenda-filter-columns]")) {
    const columns = [...table.querySelectorAll<HTMLTableColElement>("col[data-agenda-column-room]")];
    const visible = columns.map((column) => selected.has(column.dataset.agendaColumnRoom));
    for (const column of table.querySelectorAll<HTMLElement>("[data-agenda-column-room]")) {
      column.hidden = !selected.has(column.dataset.agendaColumnRoom);
    }
    for (const cell of table.querySelectorAll<HTMLTableCellElement>("[data-agenda-column-start]")) {
      const start = Number(cell.dataset.agendaColumnStart);
      const original = Number(cell.dataset.agendaColumnSpan);
      const count = columns.length ? visible.slice(start, start + original).filter(Boolean).length : original;
      cell.hidden = count === 0;
      cell.colSpan = Math.max(1, count);
    }
  }
}

/** Print every canonical day with its original spans, independent of screen filters. */
export function restoreAgendaLocationColumns(root: HTMLElement): void {
  for (const table of root.querySelectorAll<HTMLTableElement>("[data-agenda-filter-columns]")) {
    for (const column of table.querySelectorAll<HTMLElement>("[data-agenda-column-room]")) column.hidden = false;
    for (const cell of table.querySelectorAll<HTMLTableCellElement>("[data-agenda-column-start]")) {
      cell.hidden = false;
      cell.colSpan = Number(cell.dataset.agendaColumnSpan);
    }
  }
}
