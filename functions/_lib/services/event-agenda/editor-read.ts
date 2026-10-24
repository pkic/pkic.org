import { batchRows } from "../../db/pagination";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { prepareAgendaSnapshotRows, decodeAgendaSnapshotRows } from "./snapshot-rows";
import {
  prepareAgendaOccurrenceRows,
  prepareAgendaOccurrenceDetails,
  decodeAgendaOccurrences,
  type OccurrenceRow,
} from "./occurrence-read";
import { prepareAgendaSpeakers, decodeAgendaSpeakers, type AgendaSpeakerRow } from "./speaker-profiles";
import { prepareAgendaSponsorRead, type AgendaSponsorRow } from "./sponsors";
import {
  prepareAgendaEventOrganizations,
  decodeAgendaSpeakerOrganizations,
  type AgendaOrganizationRow,
} from "./speaker-organizations";
import { prepareStaffingUnavailablePairs, decodeStaffingUnavailablePairs } from "./staffing-availability";
import type { EventReadSelection } from "../events/selection";

/** Compose the canonical domain reads before execution; every projection observes one D1 batch. */
export function prepareAgendaEditorRead(db: DatabaseLike, eventId: EventReadSelection) {
  const structure = prepareAgendaSnapshotRows(db, eventId);
  const details = prepareAgendaOccurrenceDetails(db, eventId);
  const statements = [
    ...structure,
    prepareAgendaOccurrenceRows(db, eventId),
    prepareAgendaSpeakers(db, eventId),
    ...details,
    prepareAgendaSponsorRead(db, eventId),
    prepareAgendaEventOrganizations(db, eventId),
    prepareStaffingUnavailablePairs(db, eventId),
  ];
  return {
    statements,
    decode(results: D1StatementResult[]) {
      let index = structure.length;
      const rows = batchRows<OccurrenceRow>(results[index++]);
      const speakers = decodeAgendaSpeakers(batchRows<AgendaSpeakerRow>(results[index++]));
      const occurrenceDetails = results.slice(index, index + details.length);
      index += details.length;
      const sponsors = batchRows<AgendaSponsorRow>(results[index++]);
      const organizations = decodeAgendaSpeakerOrganizations(batchRows<AgendaOrganizationRow>(results[index++]));
      const unavailable = decodeStaffingUnavailablePairs(
        batchRows<{ shiftId: string; userId: string }>(results[index]),
      );
      return {
        snapshotRows: decodeAgendaSnapshotRows(results.slice(0, structure.length)),
        items: decodeAgendaOccurrences(rows, speakers, occurrenceDetails, sponsors),
        organizations,
        unavailable,
      };
    },
  };
}
