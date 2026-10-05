import { formatTimeRangeInZone } from "../../../../../../../shared/format-date";
import { snapAgendaInstant } from "./schedule-time-controls";
import { acceptedProposalDragType } from "./useAcceptedProposalPlacement";
export function AcceptedProposalDropTarget({
  startAt,
  roomId,
  roomName,
  timeZone,
  timeStep,
  proposalId,
  onPlace,
}: {
  startAt: string;
  roomId: string;
  roomName: string;
  timeZone: string;
  timeStep: number;
  proposalId: string;
  onPlace: (startAt: string, roomId: string) => void;
}) {
  const candidate = snapAgendaInstant(startAt, timeZone, timeStep);
  const label = `Schedule selected proposal at ${formatTimeRangeInZone(candidate, undefined, timeZone)} in ${roomName}`;
  return (
    <button
      type="button"
      class="pk-agenda-editor__drop"
      aria-label={label}
      onDragOver={(event) => {
        if (event.dataTransfer?.types.includes(acceptedProposalDragType)) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer?.getData(acceptedProposalDragType) === proposalId) onPlace(candidate, roomId);
      }}
      onClick={() => onPlace(candidate, roomId)}
    >
      {label}
    </button>
  );
}
