import type { ComponentProps } from "preact";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { AgendaDropTarget } from "./AgendaDropTarget";
import { AcceptedProposalDropTarget } from "./AcceptedProposalDropTarget";
import type { useAcceptedProposalPlacement } from "./useAcceptedProposalPlacement";
/** One board destination dispatches exclusively to its active selection kind. */
export function AgendaBoardDropTarget({
  snapshot,
  placement,
  ...target
}: Omit<ComponentProps<typeof AgendaDropTarget>, "roomName" | "timeZone"> & {
  snapshot: AgendaSnapshot;
  placement: ReturnType<typeof useAcceptedProposalPlacement>;
}) {
  const roomId =
    target.resizing && !target.roomId
      ? (snapshot.occurrences.find((occurrence) => occurrence.id === target.resizing)?.roomId ?? "")
      : target.roomId;
  const roomName = snapshot.rooms.find((room) => room.id === roomId)?.name ?? "Across all locations";
  if (placement.selected)
    return (
      <AcceptedProposalDropTarget
        startAt={target.instant}
        roomId={target.roomId}
        roomName={roomName}
        timeZone={snapshot.timeZone}
        timeStep={target.timeStep}
        proposalId={placement.selected.id}
        onPlace={placement.place}
      />
    );
  return target.dragged || target.resizing ? (
    <AgendaDropTarget {...target} roomId={roomId} roomName={roomName} timeZone={snapshot.timeZone} />
  ) : null;
}
