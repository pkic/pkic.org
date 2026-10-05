import { AgendaSelectionStatus } from "./AgendaSelectionStatus";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { Button } from "../../../../../../ui/Button";
import { AcceptedProposalBacklog } from "./AcceptedProposalBacklog";
import { EmptyAgendaPlacement } from "./EmptyAgendaPlacement";
import type { useAcceptedProposalPlacement } from "./useAcceptedProposalPlacement";
/** Accepted sources and the current board-selection prompt share one controller. */
export function AcceptedProposalSchedulingPanel({
  snapshot,
  visible,
  empty,
  timeStep,
  placement,
  onReview,
  onSelecting,
}: {
  snapshot: AgendaSnapshot;
  visible: boolean;
  empty: boolean;
  timeStep: number;
  placement: ReturnType<typeof useAcceptedProposalPlacement>;
  onReview: (id: string) => void;
  onSelecting: () => void;
}) {
  return (
    <>
      {visible && (
        <AcceptedProposalBacklog
          key={snapshot.revision}
          eventSlug={snapshot.eventSlug}
          onReview={onReview}
          onSelect={(proposal, native) => {
            onSelecting();
            placement.select(proposal, native);
          }}
          onDragEnd={placement.endDrag}
        />
      )}
      {placement.selected && (
        <AgendaSelectionStatus title={placement.selected.title} onCancel={placement.cancel}>
          <Button onClick={() => placement.place("", "")}>Schedule precisely</Button>
        </AgendaSelectionStatus>
      )}
      {empty && placement.selected && (
        <EmptyAgendaPlacement
          snapshot={snapshot}
          proposalId={placement.selected.id}
          timeStep={timeStep}
          onPlace={placement.place}
        />
      )}
    </>
  );
}
