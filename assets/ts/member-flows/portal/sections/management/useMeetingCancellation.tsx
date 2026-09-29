import { useCallback, useRef, useState } from "preact/hooks";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { BulkBar } from "../../../../ui/BulkBar";
import { Button } from "../../../../ui/Button";
import { toast } from "../../ui";

/** Selection stays on the loaded page; each cancellation keeps its revision guard. */
export function useMeetingCancellation<Row extends { id: string }>({
  label,
  wholeSeries = false,
  canCancel,
  cancel,
  reload,
}: {
  label: (row: Row) => string;
  wholeSeries?: boolean;
  canCancel: (row: Row) => boolean;
  cancel: (row: Row) => Promise<unknown>;
  reload: () => Promise<unknown>;
}) {
  const rows = useRef<Row[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const onRows = useCallback((page: Row[]) => {
    if (rows.current !== page) {
      rows.current = page;
      setSelected(new Set());
    }
  }, []);
  async function cancelRows(targets: Row[]) {
    if (busy || !targets.length || targets.some((row) => !canCancel(row))) return;
    if (
      !(await confirmAction({
        title: targets.length === 1 ? `Cancel ${label(targets[0])}?` : `Cancel ${targets.length} selected meetings?`,
        body: `${wholeSeries ? "All upcoming occurrences in each selected meeting will be canceled. " : ""}Invited participants receive calendar cancellations. Attendance history is preserved.`,
        consequences: targets.map(label),
        confirmLabel: "Cancel selected meetings",
        cancelLabel: "Keep meetings",
      }))
    )
      return;
    setBusy(true);
    let completed = 0;
    const failures: string[] = [];
    try {
      for (const row of targets) {
        try {
          await cancel(row);
          completed++;
        } catch (error) {
          failures.push(`${label(row)}: ${(error as Error).message}`);
        }
      }
      toast(
        `Canceled ${completed} of ${targets.length}.${failures.length ? ` ${failures.join("; ")}` : ""}`,
        failures.length ? "error" : "success",
      );
      await reload();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  const targets = rows.current.filter((row) => selected.has(row.id));
  return {
    onRows,
    busy,
    cancelRows,
    selection: {
      selected,
      onChange: (next: ReadonlySet<string>) => {
        if (!busy) setSelected(next);
      },
      rowLabel: (id: string) => {
        const row = rows.current.find((row) => row.id === id);
        return row ? label(row) : id;
      },
    },
    bulkBar: (
      <BulkBar
        count={selected.size}
        total={rows.current.length}
        onClear={() => {
          if (!busy) setSelected(new Set());
        }}
      >
        <Button
          size="sm"
          disabled={busy || !targets.length || targets.some((row) => !canCancel(row))}
          onClick={() => void cancelRows(targets)}
        >
          Cancel selected…
        </Button>
        {targets.some((row) => !canCancel(row)) && <span>Select only scheduled meetings you manage.</span>}
      </BulkBar>
    ),
  };
}
