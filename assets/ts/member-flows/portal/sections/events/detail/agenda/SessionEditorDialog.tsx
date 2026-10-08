import { lazy, Suspense } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import type { AgendaOccurrence, AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { Dialog } from "../../../../../../ui/Dialog";
import { Spinner } from "../../../../../../components/Spinner";
import type { ComponentProps } from "preact";
import type { RowActionsProps } from "../../../../../../ui/RowActions";
import "./SessionEditorDialog.css";

const Editor = lazy(() => import("./SessionEditor").then((module) => ({ default: module.SessionEditor })));

export function AgendaSessionEditor({
  actions,
  occurrence,
  ...props
}: Omit<ComponentProps<typeof Editor>, "actions" | "occurrence"> & {
  occurrence: AgendaOccurrence;
  actions: (occurrence: AgendaOccurrence, close: () => void) => RowActionsProps["actions"];
}) {
  return (
    <Suspense fallback={<Spinner label="Loading session editor…" />}>
      <Editor
        {...props}
        key={`${occurrence.id}:${occurrence.roomId}:${occurrence.capacity}:${(occurrence.additionalRoomIds ?? []).join(",")}`}
        occurrence={occurrence}
        actions={(close) => actions(occurrence, close)}
      />
    </Suspense>
  );
}

/** Keep the selected calendar window visible while entering the session details. */
export function SessionEditorDialog({
  snapshot,
  initialSchedule,
  occurrence,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  initialSchedule?: Pick<AgendaOccurrence, "startAt" | "endAt" | "roomId">;
  occurrence?: AgendaOccurrence;
  onSaved: (snapshot: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      title={occurrence ? "Edit session" : "New session"}
      confirmLabel={busy ? "Saving…" : "Save session"}
      confirmDisabled={busy}
      onConfirm={() => root.current?.querySelector("form")?.requestSubmit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <div ref={root} class="pk-session-editor-dialog__content">
        <Suspense fallback={<Spinner label="Loading session editor…" />}>
          <Editor
            snapshot={snapshot}
            occurrence={occurrence}
            initialSchedule={initialSchedule}
            onSaved={onSaved}
            onClose={onClose}
            dialog
            onBusy={setBusy}
          />
        </Suspense>
      </div>
    </Dialog>
  );
}
