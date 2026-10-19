import { agendaStaffingReport } from "../../../../assets/shared/event-agenda-staffing";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import type { DatabaseLike } from "../../types";
import { getStaffingUnavailablePairs } from "./staffing-availability";
/** Report current eligibility only for uncovered positions; private external event details stay server-side. */
export async function getAgendaStaffingReport(db: DatabaseLike, eventId: string, snapshot: AgendaSnapshot) {
  const unfilledPositions = snapshot.staffingPositions.filter(
    (position) => !snapshot.assignments.some((assignment) => assignment.positionId === position.id),
  );
  const unavailable = unfilledPositions.length
    ? await getStaffingUnavailablePairs(db, eventId, { ...snapshot, staffingPositions: unfilledPositions })
    : [];
  return agendaStaffingReport(
    snapshot,
    new Set(unavailable.map(({ shiftId, userId }) => JSON.stringify([shiftId, userId]))),
  );
}
