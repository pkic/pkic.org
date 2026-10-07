import { useEffect, useState } from "preact/hooks";

export function useAgendaTargetSelection(
  scope: string,
  busy: boolean,
  occurrences?: ReadonlyArray<{ id: string }>,
  locked = false,
) {
  const [selection, setSelection] = useState<{ id: string; kind: "move" | "resize"; native: boolean } | null>(null);
  const cancel = () => setSelection(null);
  useEffect(cancel, [scope]);
  useEffect(() => {
    if (locked) cancel();
  }, [locked]);
  useEffect(() => {
    setSelection((current) =>
      current && occurrences && !occurrences.some((occurrence) => occurrence.id === current.id) ? null : current,
    );
  }, [occurrences]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) cancel();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy]);
  return {
    native: selection?.native ?? false,
    dragged: selection?.kind === "move" ? selection.id : null,
    resizing: selection?.kind === "resize" ? selection.id : null,
    select: (id: string, kind: "move" | "resize", native = false) => {
      if (!busy && !locked) setSelection({ id, kind, native });
    },
    endDrag: () => setSelection((current) => (current?.native ? null : current)),
    cancel,
  };
}
