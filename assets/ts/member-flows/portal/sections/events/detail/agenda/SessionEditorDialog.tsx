import { lazy, Suspense } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import type { AgendaOccurrence, AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { agendaSessionWhen } from "../../../../../../../shared/agenda-time-display";
import { contractClock } from "../../../../../../../shared/event-clock";
import { Dialog } from "../../../../../../ui/Dialog";
import { Badge } from "../../../../../../ui/Badge";
import { pendingSpeakersLabel } from "../../../../../../../shared/proposal-speaker-acceptance";
import { Spinner } from "../../../../../../components/Spinner";
import type { SessionEditorHeading } from "./SessionEditor";
import "../../../../../../../design/tokens.agenda.generated.css";
import "./SessionEditorDialog.css";

const Editor = lazy(() => import("./SessionEditor").then((module) => ({ default: module.SessionEditor })));

/** The location colors cycle as they do on the agenda board: the first location wears the accent. */
const LOCATION_COLORS = 7;

/**
 * The session details dialog's anatomy, for editing: the location as the kicker, the session title as
 * the dialog title while it is typed, and when it runs on the event's clock.
 */
function editorHeader(
  snapshot: AgendaSnapshot,
  heading: SessionEditorHeading,
  creating: boolean,
  pendingSpeakers: number,
) {
  const rooms = [heading.roomId, ...heading.additionalRoomIds]
    .map((id) => snapshot.rooms.find((room) => room.id === id)?.name)
    .filter(Boolean);
  const locationIndex = snapshot.rooms.findIndex((room) => room.id === heading.roomId);
  const when = heading.startAt ? agendaSessionWhen(heading.startAt, heading.endAt, contractClock(snapshot)) : undefined;
  return {
    title: heading.title.trim() || (creating ? "New session" : "Untitled session"),
    kicker: rooms.length ? (
      <span class="pk-session-editor-dialog__location" data-location={Math.max(0, locationIndex) % LOCATION_COLORS}>
        {rooms.join(" / ")}
      </span>
    ) : undefined,
    meta: (
      <>
        {when ? (
          <>
            {when.date} · <span class="pk-session-editor-dialog__time">{when.time}</span>
          </>
        ) : (
          "Not scheduled"
        )}
        {pendingSpeakers > 0 && (
          <span class="pk-session-editor-dialog__status">
            <Badge tone="warn">{pendingSpeakersLabel(pendingSpeakers)}</Badge>
          </span>
        )}
      </>
    ),
  };
}

/** Keep the selected calendar window visible while entering the session details. */
export function SessionEditorDialog({
  snapshot,
  initialSchedule,
  occurrence,
  onSaved,
  onClose,
  onManageSlides,
}: {
  snapshot: AgendaSnapshot;
  initialSchedule?: Pick<AgendaOccurrence, "startAt" | "endAt" | "roomId">;
  occurrence?: AgendaOccurrence;
  onSaved: (snapshot: AgendaSnapshot) => void;
  onClose: () => void;
  onManageSlides?: (occurrence: AgendaOccurrence) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const schedule = occurrence ?? initialSchedule;
  const [heading, setHeading] = useState<SessionEditorHeading>({
    title: occurrence?.title ?? "",
    startAt: schedule?.startAt ?? null,
    endAt: schedule?.endAt ?? null,
    roomId: schedule?.roomId ?? null,
    additionalRoomIds: occurrence?.additionalRoomIds ?? [],
  });
  const header = editorHeader(snapshot, heading, !occurrence, occurrence?.pendingSpeakerCount ?? 0);
  return (
    <Dialog
      open
      class="pk-session-editor-dialog"
      title={header.title}
      kicker={header.kicker}
      meta={header.meta}
      closeLabel="Close session editor"
      confirmLabel={busy ? "Saving…" : "Save session"}
      confirmDisabled={busy}
      onConfirm={() => root.current?.querySelector("form")?.requestSubmit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <div ref={root}>
        <Suspense fallback={<Spinner label="Loading session editor…" />}>
          <Editor
            snapshot={snapshot}
            occurrence={occurrence}
            initialSchedule={initialSchedule}
            onSaved={onSaved}
            onClose={onClose}
            onManageSlides={onManageSlides}
            onBusy={setBusy}
            onHeading={setHeading}
          />
        </Suspense>
      </div>
    </Dialog>
  );
}
