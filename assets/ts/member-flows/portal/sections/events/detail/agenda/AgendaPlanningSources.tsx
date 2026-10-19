import type { ComponentProps } from "preact";
import { AgendaSessionSources } from "./AgendaSessionSources";
import { AgendaSourcesPanel } from "./AgendaSourcesPanel";
import { agendaCardActions } from "./session-actions";
import { AcceptedProposalSchedulingPanel } from "./AcceptedProposalSchedulingPanel";
import { UnscheduledAgendaSessions } from "./UnscheduledAgendaSessions";
import type { useAgendaTargetSelection } from "./useAgendaTargetSelection";

type AcceptedProps = ComponentProps<typeof AcceptedProposalSchedulingPanel>;
type UnscheduledProps = ComponentProps<typeof UnscheduledAgendaSessions>;

/** One source collection at a time, with the same calendar placement callbacks. */
export function AgendaPlanningSources({
  snapshot,
  canEdit,
  open,
  onClose,
  timeStep,
  viewedDay,
  placement,
  target,
  onSaved,
  onReview,
  locked,
  busy,
  actions,
}: {
  snapshot: AcceptedProps["snapshot"];
  canEdit: boolean;
  open: boolean;
  onClose: () => void;
  timeStep: number;
  viewedDay?: string;
  placement: AcceptedProps["placement"];
  target: ReturnType<typeof useAgendaTargetSelection>;
  onSaved: AcceptedProps["onSaved"];
  onReview: AcceptedProps["onReview"];
  locked: boolean;
  busy: boolean;
  actions: UnscheduledProps["actions"];
}) {
  return (
    <AgendaSourcesPanel id={`agenda-sources-${snapshot.eventSlug}`} open={open} onClose={onClose}>
      <AgendaSessionSources
        accepted={
          canEdit ? (
            <AcceptedProposalSchedulingPanel
              snapshot={snapshot}
              visible
              timeStep={timeStep}
              viewedDay={viewedDay}
              placement={placement}
              onSelecting={target.cancel}
              onSaved={onSaved}
              canEdit={canEdit}
              interactionsDisabled={locked}
              onReview={onReview}
            />
          ) : undefined
        }
        unscheduled={
          <UnscheduledAgendaSessions
            snapshot={snapshot}
            canEdit={canEdit}
            interactionsDisabled={locked || busy}
            onMove={(id, dragging) => {
              placement.cancel();
              target.select(id, "move", dragging);
            }}
            onDragEnd={target.endDrag}
            actions={(occurrence, close) => agendaCardActions(actions(occurrence, close))}
          />
        }
      />
    </AgendaSourcesPanel>
  );
}
