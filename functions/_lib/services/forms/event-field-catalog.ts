import type { FormPurpose } from "../../../../assets/shared/schemas/forms";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import type { DatabaseLike } from "../../types";
import { defaultFormAudience } from "./placements";

/** Read only requested names from the event's placed and legacy submitted form definitions. */
export function prepareEventFormFieldKeys(
  db: DatabaseLike,
  eventId: string,
  purpose: Extract<FormPurpose, "event_registration" | "proposal_submission">,
  names: readonly string[],
) {
  const requested = buildD1JsonMembershipFilter("field.key", [...new Set(names)]);
  const source =
    purpose === "event_registration"
      ? { table: "registrations", context: "registration" }
      : { table: "session_proposals", context: "proposal" };
  return db
    .prepare(`WITH applicable_forms AS (
    SELECT placement.form_id FROM form_placements placement
    WHERE placement.context_type='event' AND placement.context_ref=? AND placement.audience=?
    UNION
    SELECT submission.form_id FROM form_submissions submission
    JOIN ${source.table} response ON response.id=submission.context_ref
    JOIN forms definition ON definition.id=submission.form_id
    WHERE submission.context_type=? AND response.event_id=? AND submission.placement_id IS NULL
      AND (definition.scope_type='global' OR (definition.scope_type='event' AND definition.scope_ref=?))
  )
  SELECT DISTINCT field.key FROM applicable_forms applicable
  JOIN forms definition ON definition.id=applicable.form_id
  JOIN form_fields field ON field.form_id=definition.id
  WHERE definition.purpose=? AND ${requested.sql}
  ORDER BY field.key`)
    .bind(eventId, defaultFormAudience(purpose), source.context, eventId, eventId, purpose, ...requested.bindings);
}
