/**
 * What a list lets its reader do to its columns — sort, narrow, hide — kept
 * in one place so the two places that offer it say the same thing.
 *
 * On a wide list each command sits in its column's `…` menu. When the list
 * is narrow enough to draw its rows as record cards, there are no column
 * heads to hang those menus on: they used to become a strip of pill chips,
 * "Attendance ⋯", that ran off the side of the card. The same sort and
 * filter commands then collapse into one menu in the list's toolbar
 * (`ColumnCardMenu`), built from the same state as the column menus.
 */
import { StrokeIcon } from "../ui/MediaIcons";
import { useState } from "preact/hooks";
import type { MenuItem } from "../ui/Menu";
import { SplitButton } from "../ui/SplitButton";
import type { Column, HeadCell } from "./Table";
import type { AppliedFilterChip } from "./table-filter-strip";

export function headLabel(head: HeadCell): string {
  return typeof head === "string" ? head : head.label;
}

export interface ColumnControlsOptions {
  /** The current `sort` query value, as the server understands it. */
  currentSort?: string;
  onSort?: (nextSort: string) => void;
  /** The column filters in force, by query parameter. */
  filters?: Record<string, string>;
  /** Called with the parameter and its new value ("" opens the column back up). */
  onFilterChange?: (param: string, value: string) => void;
}

export interface ColumnControls<T> {
  /** Headers of the columns the reader has hidden for this visit. */
  hidden: ReadonlySet<string>;
  /** The query parameter of the column whose typed filter is open, if any. */
  filterOpen: string | null;
  setFilterOpen: (next: string | null | ((current: string | null) => string | null)) => void;
  /** The column that takes a wide screen's slack. */
  slackIndex: number;
  menuFor: (column: Column<T>, index: number) => MenuItem[];
  filterSummaryFor: (column: Column<T>) => string | undefined;
  /** The menu at the end of the head that brings hidden columns back. */
  columnsMenu: MenuItem[];
  /** Every narrowing in force, as removable chips above the rows. */
  chips: AppliedFilterChip[];
  /** Sorting and filtering for the record-card layout, as one menu. */
  cardMenuItems: MenuItem[];
  /** Whether the list offers sorting, filtering, or both — names the card menu. */
  cardMenuLabel: string | null;
}

/** The sort, filter and column-visibility state of one list. */
export function useColumnControls<T>(
  columns: readonly Column<T>[],
  { currentSort, onSort, filters = {}, onFilterChange }: ColumnControlsOptions,
): ColumnControls<T> {
  // Hidden columns are the reader's choice for this visit; they are keyed by
  // header so the choice survives a re-render that rebuilds the column list.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set(columns.filter((column) => column.defaultHidden).map((column) => headLabel(column.header))),
  );
  // Which column's typed filter is open, by query parameter. One at a time:
  // the row appears above the rows it narrows, and two of them would push the
  // table further from the control acting on it.
  const [filterOpen, setFilterOpen] = useState<string | null>(null);

  /*
   * One column takes a wide screen's slack. When no column claims `primary`,
   * the first one gets it: a list leads with its subject, and the subject is
   * where extra room does the most good.
   */
  const primaryIndex = columns.findIndex((column) => column.width === "primary");
  const slackIndex =
    primaryIndex >= 0 ? primaryIndex : columns.findIndex((column) => headLabel(column.header).trim().length > 0);

  const canHide = (column: Column<T>, index: number) =>
    column.hideable ?? (index !== slackIndex && headLabel(column.header).trim().length > 0);

  function sortItems(column: Column<T>, id: string, labels: { asc: string; desc: string }): MenuItem[] {
    const columnSort = column.sort;
    if (!columnSort || !onSort) return [];
    return [
      {
        id: `${id}-asc`,
        label: labels.asc,
        checked: currentSort === columnSort.asc,
        onSelect: () => onSort(columnSort.asc),
      },
      {
        id: `${id}-desc`,
        label: labels.desc,
        checked: currentSort === columnSort.desc,
        onSelect: () => onSort(columnSort.desc),
      },
    ];
  }

  function filterItems(column: Column<T>, id: string, optionsLabel: string): MenuItem[] {
    const columnFilter = column.filter;
    if (!columnFilter || !onFilterChange) return [];
    const current = filters[columnFilter.param] ?? "";
    const items: MenuItem[] = [];
    if (columnFilter.options) {
      items.push({
        id: `${id}-filter`,
        label: optionsLabel,
        onSelect: () => {},
        children: [
          ...columnFilter.options.map((option) => ({
            id: `${id}-filter-${option.value || "all"}`,
            label: option.label,
            checked: current === option.value,
            onSelect: () => onFilterChange(columnFilter.param, option.value),
          })),
          ...(columnFilter.optionNavigation ?? []),
        ],
      });
    }
    if (columnFilter.text) {
      // An open vocabulary cannot be listed, so the menu offers the control
      // that can take one. "Edit" rather than "Filter" once something is in
      // force, so the item says whether the column is already narrowed.
      items.push({
        id: `${id}-filter-text`,
        label: current ? "Edit filter…" : "Filter this column…",
        onSelect: () => setFilterOpen(columnFilter.param),
      });
      if (current) {
        items.push({
          id: `${id}-filter-clear`,
          label: "Clear filter",
          onSelect: () => {
            onFilterChange(columnFilter.param, "");
            setFilterOpen((open) => (open === columnFilter.param ? null : open));
          },
        });
      }
    }
    return items;
  }

  /**
   * The column's commands, in the order a reader reaches for them: the sort
   * directions, then the values it can be narrowed to, then hiding it. Each
   * choice shows whether it is the one in force, so the menu is also where the
   * reader sees the table's current shape.
   */
  function menuFor(column: Column<T>, index: number): MenuItem[] {
    const id = `column-${String(index)}`;
    const items: MenuItem[] = sortItems(column, id, { asc: "Sort ascending", desc: "Sort descending" });
    for (const item of filterItems(column, id, "Filter")) {
      // The typed filter starts a group of its own after whatever precedes it.
      items.push(item.id.endsWith("-filter-text") ? { ...item, separatorBefore: items.length > 0 } : item);
    }
    if (canHide(column, index)) {
      items.push({
        id: `${id}-hide`,
        label: "Hide column",
        separatorBefore: items.length > 0,
        onSelect: () => setHidden((current) => new Set([...current, headLabel(column.header)])),
      });
    }
    return items;
  }

  function filterSummaryFor(column: Column<T>): string | undefined {
    if (!column.filter) return undefined;
    const current = filters[column.filter.param];
    if (!current) return undefined;
    // A typed value is its own summary; an enum value reads by its label, so
    // "role=observer" is stated as the word the reader chose.
    return column.filter.options?.find((option) => option.value === current)?.label ?? current;
  }

  const columnsMenu: MenuItem[] = columns.flatMap((column, index) => {
    if (!canHide(column, index)) return [];
    const label = headLabel(column.header);
    return [
      {
        id: `columns-${String(index)}`,
        label,
        checked: !hidden.has(label),
        onSelect: () =>
          setHidden((current) => {
            const next = new Set(current);
            if (next.has(label)) next.delete(label);
            else next.add(label);
            return next;
          }),
      },
    ];
  });

  const chips: AppliedFilterChip[] = [];
  if (onFilterChange) {
    for (const column of columns) {
      const columnFilter = column.filter;
      const summary = columnFilter ? filterSummaryFor(column) : undefined;
      if (!columnFilter || summary === undefined) continue;
      const label = headLabel(column.header);
      chips.push({
        id: `filter-${columnFilter.param}`,
        label: `${label}: ${summary}`,
        clearLabel: `Clear the ${label} filter`,
        onClear: () => {
          onFilterChange(columnFilter.param, "");
          setFilterOpen((open) => (open === columnFilter.param ? null : open));
        },
      });
    }
  }

  // The record cards' one menu: a submenu per sortable column, then one per
  // filterable column. Hidden columns stay out of it, as they are out of the cards.
  const visibleColumns = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !hidden.has(headLabel(column.header)) && headLabel(column.header).trim().length > 0);
  const sortMenu: MenuItem[] = visibleColumns.flatMap(({ column, index }) => {
    const children = sortItems(column, `card-${String(index)}`, { asc: "Ascending", desc: "Descending" });
    if (children.length === 0) return [];
    return [
      { id: `card-sort-${String(index)}`, label: `Sort by ${headLabel(column.header)}`, onSelect: () => {}, children },
    ];
  });
  const filterMenu: MenuItem[] = visibleColumns.flatMap(({ column, index }) => {
    const name = headLabel(column.header);
    const narrowed = Boolean(column.filter && filters[column.filter.param]);
    return filterItems(column, `card-${String(index)}`, `Filter by ${name}`).map((item) =>
      item.id.endsWith("-filter-text")
        ? { ...item, label: narrowed ? `Edit the ${name} filter…` : `Filter by ${name}…` }
        : item.id.endsWith("-filter-clear")
          ? { ...item, label: `Clear the ${name} filter` }
          : item,
    );
  });
  const cardMenuItems = [
    ...sortMenu,
    ...filterMenu.map((item, position) =>
      position === 0 && sortMenu.length > 0 ? { ...item, separatorBefore: true } : item,
    ),
  ];
  const cardMenuLabel =
    sortMenu.length > 0 && filterMenu.length > 0
      ? "Sort and filter"
      : sortMenu.length > 0
        ? "Sort"
        : filterMenu.length > 0
          ? "Filter"
          : null;

  return {
    hidden,
    filterOpen,
    setFilterOpen,
    slackIndex,
    menuFor,
    filterSummaryFor,
    columnsMenu,
    chips,
    cardMenuItems,
    cardMenuLabel,
  };
}

/**
 * The record cards' sort and filter menu, drawn in the list's toolbar. The
 * stylesheet shows it only while the rows are drawn as cards, which is also
 * when the column heads that carry the same commands are out of sight.
 */
export function ColumnCardMenu<T>({
  controls,
  caption,
  alwaysVisible = false,
}: {
  controls: ColumnControls<T>;
  caption: string;
  alwaysVisible?: boolean;
}) {
  if (!controls.cardMenuLabel || controls.cardMenuItems.length === 0) return null;
  return (
    <span class={`pk-table-list__card-menu${alwaysVisible ? " pk-table-list__card-menu--always" : ""}`}>
      <SplitButton
        variant="secondary"
        label={`${controls.cardMenuLabel} ${caption.toLowerCase()}`}
        icon={
          <>
            <StrokeIcon class="pk-toolbar-compact-icon">
              <path d="M3 2v12m-2-2 2 2 2-2M8 3h6M8 8h4M8 13h2" />
            </StrokeIcon>
            <span class="pk-toolbar-control-label">{controls.cardMenuLabel}</span>
          </>
        }
        items={controls.cardMenuItems}
      />
    </span>
  );
}
