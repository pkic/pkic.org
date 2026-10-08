import { useAcceptedProposalImport } from "./useAcceptedProposalImport";
import { AgendaSelectionStatus } from "./AgendaSelectionStatus";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { lazy, Suspense } from "preact/compat";
import { Spinner } from "../../../../../../components/Spinner";
import type { useAcceptedProposalPlacement } from "./useAcceptedProposalPlacement";
const AcceptedProposalBacklog = lazy(() =>
  import("./AcceptedProposalBacklog").then((module) => ({ default: module.AcceptedProposalBacklog })),
);

/** Accepted sources and the current board-selection prompt share one controller. */
export function AcceptedProposalSchedulingPanel({
  snapshot,
  visible,
  timeStep,
  viewedDay,
  placement,
  onReview,
  onSaved,
  canEdit,
  interactionsDisabled = false,
  onSelecting,
}: {
  snapshot: AgendaSnapshot;
  visible: boolean;
  timeStep: number;
  viewedDay?: string;
  placement: ReturnType<typeof useAcceptedProposalPlacement>;
  onReview: (id: string) => void;
  onSaved: (agenda: AgendaSnapshot) => void;
  canEdit: boolean;
  interactionsDisabled?: boolean;
  onSelecting: () => void;
}) {
  const importing = useAcceptedProposalImport(snapshot, onSaved, canEdit, viewedDay, timeStep);
  return (
    <>
      {visible && (
        <Suspense fallback={<Spinner label="Loading accepted proposals…" />}>
          <AcceptedProposalBacklog
            key={snapshot.revision}
            eventSlug={snapshot.eventSlug}
            onReview={onReview}
            onAdd={canEdit ? (ids) => void importing.add(ids) : undefined}
            interactionsDisabled={interactionsDisabled}
            adding={importing.busy}
            addError={importing.error}
            addProgress={importing.progress}
            onSelect={(proposal, native) => {
              if (interactionsDisabled) return;
              onSelecting();
              placement.select(proposal, native);
            }}
            onDragEnd={placement.endDrag}
          />
        </Suspense>
      )}
      {placement.selected && (
        <AgendaSelectionStatus title={placement.selected.title} onCancel={placement.cancel}>
          <span>Choose a free calendar slot to place this proposal.</span>
        </AgendaSelectionStatus>
      )}
    </>
  );
}
