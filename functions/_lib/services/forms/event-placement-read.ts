import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import type { FormPurpose } from "../../../../assets/shared/schemas/forms";
import { AppError } from "../../errors";
import { FORM_COLUMNS, type FormRow } from "./definition-model";
import { FORM_PLACEMENT_COLUMNS, mapFormPlacement, defaultFormAudience, type FormPlacementRow } from "./placements";
import { formSubmissionWindowOpenSql } from "./submission-window";

export type PlacedEventFormRow = Omit<FormRow, "id" | "updated_at"> &
  FormPlacementRow & {
    definition_id: string;
    definition_updated_at: string;
    event_owner_group_id: string | null;
    event_source_mode: string | null;
  };

/** Select only the explicitly placed event form; definitions are never inferred from scope or settings. */
export function placedEventFormSelection(
  event: EventReadSelection,
  purpose: FormPurpose,
  options: { includeClosed?: boolean } = {},
) {
  const selection = eventReadIdSql(event);
  return {
    sql: `SELECT ${FORM_COLUMNS.split(", ")
      .map((column) => (column === "id" ? "f.id AS definition_id" : `f.${column}`))
      .join(", ")},
            f.updated_at AS definition_updated_at,
            ${FORM_PLACEMENT_COLUMNS.split(/,\s*/)
              .map((column) => `fp.${column}`)
              .join(", ")},
            event.owner_group_id AS event_owner_group_id,
            event.source_mode AS event_source_mode
     FROM form_placements fp
     JOIN forms f ON f.id = fp.form_id
     JOIN events event ON event.id = fp.context_ref
     WHERE fp.context_type = 'event'
       AND fp.context_ref = ${selection.sql}
       AND fp.active = 1
       AND f.status = 'active'
       AND f.purpose = ?
       ${purpose === "event_registration" || purpose === "proposal_submission" ? "AND fp.audience = ?" : ""}
       ${options.includeClosed || purpose === "proposal_submission" ? "" : `AND ${formSubmissionWindowOpenSql("fp")}`}
     ORDER BY fp.created_at ASC, fp.id ASC
     LIMIT 2`,
    bindings: [
      ...selection.bindings,
      purpose,
      ...(purpose === "event_registration" || purpose === "proposal_submission" ? [defaultFormAudience(purpose)] : []),
    ],
  };
}

export function decodePlacedEventForm(rows: PlacedEventFormRow[]) {
  if (rows.length > 1) {
    throw new AppError(503, "FORM_PLACEMENT_AMBIGUOUS", "Multiple active forms are configured for this event flow");
  }
  const row = rows[0];
  if (!row) return null;
  if (
    row.event_source_mode === "portal" &&
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
