import { agendaSessionContent } from "../../../../../../../shared/public-agenda-content";
import { publicSessionTiming } from "../../../../../../../shared/session-public-timing";
import type { AgendaOccurrence, AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { AgendaSession } from "../../../../../../site/AgendaSession";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { RowActions, type RowActionsProps } from "../../../../../../ui/RowActions";
import "../../../../../../site/ContentAgenda.css";
import "./AgendaSourceCards.css";

/** Placement sources use the same card and projection as the scheduled agenda. */
export function UnscheduledAgendaSessions({
  snapshot,
  canEdit,
  interactionsDisabled = false,
  onMove,
  onDragEnd,
  actions,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  interactionsDisabled?: boolean;
  onMove: (id: string, dragging: boolean) => void;
  onDragEnd: () => void;
  actions: (occurrence: AgendaOccurrence, beforeSelect?: () => void) => RowActionsProps["actions"];
}) {
  const occurrences = snapshot.occurrences.filter((occurrence) => !occurrence.startAt || !occurrence.endAt);
  const locations = snapshot.rooms.map((room) => ({ id: room.id, label: room.name }));
  return (
    <Panel class="pk-agenda-source-panel">
      <PanelHeader title="Unscheduled sessions" />
      <PanelBody>
        <div class="pk-stack pk-agenda-source-cards" aria-label="Unscheduled sessions">
          {occurrences.length === 0 && <p class="pk-muted">All sessions are scheduled.</p>}
          {occurrences.map((occurrence) => {
            const timing = publicSessionTiming(occurrence);
            return (
              <AgendaSession
                key={occurrence.id}
                session={agendaSessionContent(snapshot, occurrence, true)}
                slot={timing ? { startsAt: timing.startAt } : undefined}
                locations={locations}
                timeZone={snapshot.timeZone}
                dialogId={`unscheduled-session-${occurrence.id}`}
                editor={{
                  controls: (
                    <div class="pk-agenda-editor__card-actions">
                      <RowActions subject={occurrence.title} actions={actions(occurrence)} />
                    </div>
                  ),
                  detailControls: (close) => (
                    <RowActions subject={occurrence.title} actions={actions(occurrence, close)} />
                  ),
                  onDragEnd,
                  onDragStart:
                    canEdit && !interactionsDisabled
                      ? (event) => {
                          const card = event.currentTarget;
                          const bounds = card.getBoundingClientRect();
                          event.dataTransfer?.setData("text/plain", occurrence.id);
                          event.dataTransfer?.setDragImage(
                            card,
                            event.clientX - bounds.left,
                            event.clientY - bounds.top,
                          );
                          onMove(occurrence.id, true);
                        }
                      : undefined,
                }}
              />
            );
          })}
        </div>
      </PanelBody>
    </Panel>
  );
}
