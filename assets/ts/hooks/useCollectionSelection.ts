import { useCallback, useState } from "preact/hooks";
import type { DataTableSelection } from "../ui/DataTable";

/** Selection belongs to one loaded server page, never an inferred full collection. */
export function useCollectionSelection<Row>({
  rowKey,
  rowLabel,
  busy = false,
}: {
  rowKey: (row: Row) => string;
  rowLabel: (row: Row) => string;
  busy?: boolean;
}) {
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const clear = useCallback(() => setSelected(new Set()), []);
  const onQueryChange = useCallback(() => {
    setRows([]);
    setSelected(new Set());
  }, []);
  const onRows = useCallback((next: readonly Row[]) => {
    setRows(next);
    setSelected(new Set());
  }, []);
  const selection: DataTableSelection = {
    disabled: busy,
    selected,
    onChange: (next) => {
      if (!busy) setSelected(new Set(rows.filter((row) => next.has(rowKey(row))).map(rowKey)));
    },
    rowLabel: (id) => {
      const row = rows.find((value) => rowKey(value) === id);
      return row ? rowLabel(row) : "Select row";
    },
  };
  return {
    selected,
    selectedRows: rows.filter((row) => selected.has(rowKey(row))),
    total: rows.length,
    selectPage: (checked: boolean) => {
      if (!busy) setSelected(checked ? new Set(rows.map(rowKey)) : new Set());
    },
    selection,
    onRows,
    onQueryChange,
    clear,
  };
}
