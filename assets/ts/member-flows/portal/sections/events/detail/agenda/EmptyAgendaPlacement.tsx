import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { AcceptedProposalDropTarget } from "./AcceptedProposalDropTarget";
/** An empty agenda still has its real event opening and configured locations. */
export function EmptyAgendaPlacement({
  snapshot,
  proposalId,
  timeStep,
  onPlace,
}: {
  snapshot: AgendaSnapshot;
  proposalId: string;
  timeStep: number;
  onPlace: (startAt: string, roomId: string) => void;
}) {
  return (
    <Panel>
      <PanelHeader title="Schedule the first session" />
      <PanelBody>
        <p>Drop the proposal at the event opening in a location, then choose its exact start and end in the review.</p>
        {snapshot.eventStartsAt &&
          snapshot.rooms.map((room) => (
            <AcceptedProposalDropTarget
              startAt={snapshot.eventStartsAt!}
              roomId={room.id}
              roomName={room.name}
              timeZone={snapshot.timeZone}
              timeStep={timeStep}
              proposalId={proposalId}
              onPlace={onPlace}
            />
          ))}
        {(!snapshot.eventStartsAt || !snapshot.rooms.length) && (
          <p>Use Schedule precisely to choose the time and location. Configure locations if none are available.</p>
        )}
      </PanelBody>
    </Panel>
  );
}
