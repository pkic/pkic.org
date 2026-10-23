import type { DatabaseLike } from "../../types";
import type { FormPurpose } from "../../../../assets/shared/schemas/forms";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { FORM_COLUMNS, type FormRow } from "./definition-model";
import { FORM_PLACEMENT_COLUMNS, mapFormPlacement, defaultFormAudience, type FormPlacementRow } from "./placements";
import { formSubmissionWindowOpenSql } from "./submission-window";

export type EventPlacementOwnershipPolicy = "legacy" | "portal_owner";

export type PlacedEventFormRow = Omit<FormRow, "id" | "updated_at"> &
  FormPlacementRow & {
    definition_id: string;
    definition_updated_at: string;
    event_owner_group_id: string | null;
  };

/**
 * Finds an exact proposal placement even outside its window, so a closed call
 * cannot inherit an open installation form. Other purposes retain their open-window policy.
 * Hugo compatibility may use any
 * historic event placement; portal events must use the event owner's group
 * form and fail closed for malformed records.
 */
export function placedEventFormSelection(
  eventId: string,
  purpose: FormPurpose,
  key?: string,
  ownership: EventPlacementOwnershipPolicy = "legacy",
) {
  return {
    sql: `SELECT ${FORM_COLUMNS.split(", ")
      .map((column) => (column === "id" ? "f.id AS definition_id" : `f.${column}`))
      .join(", ")},
            f.updated_at AS definition_updated_at,
            ${FORM_PLACEMENT_COLUMNS.split(/,\s*/)
              .map((column) => `fp.${column}`)
              .join(", ")},
            event.owner_group_id AS event_owner_group_id
     FROM form_placements fp
     JOIN forms f ON f.id = fp.form_id
     JOIN events event ON event.id = fp.context_ref
     WHERE fp.context_type = 'event'
       AND fp.context_ref = ?
       AND fp.active = 1
       AND f.status = 'active'
       AND f.purpose = ?
       ${ownership === "portal_owner" ? "AND event.source_mode = 'portal'" : ""}
       ${purpose === "event_registration" || purpose === "proposal_submission" ? "AND fp.audience = ?" : ""}
       ${key ? "AND f.key = ?" : ""}
       ${purpose === "proposal_submission" ? "" : `AND ${formSubmissionWindowOpenSql("fp")}`}
     ORDER BY fp.created_at ASC, fp.id ASC
     LIMIT 2`,
    bindings: [
      eventId,
      purpose,
      ...(purpose === "event_registration" || purpose === "proposal_submission" ? [defaultFormAudience(purpose)] : []),
      ...(key ? [key] : []),
    ],
  };
}

export function decodePlacedEventForm(rows: PlacedEventFormRow[], ownership: EventPlacementOwnershipPolicy) {
  if (rows.length > 1) {
    throw new AppError(503, "FORM_PLACEMENT_AMBIGUOUS", "Multiple active forms are configured for this event flow");
  }
  const row = rows[0];
  if (!row) return null;
  if (
    ownership === "portal_owner" &&
    (!row.event_owner_group_id ||
      row.owner_group_id !== row.event_owner_group_id ||
      row.scope_type !== "community" ||
      row.scope_ref !== row.event_owner_group_id)
  ) {
    return null;
  }
  return {
    form: { ...row, id: row.definition_id, updated_at: row.definition_updated_at },
    placement: mapFormPlacement(row),
  };
}

export async function findPlacedEventForm(db: DatabaseLike, eventId: string, purpose: FormPurpose, key?: string) {
  const selection = placedEventFormSelection(eventId, purpose, key);
  return decodePlacedEventForm(await all<PlacedEventFormRow>(db, selection.sql, selection.bindings), "legacy");
}
