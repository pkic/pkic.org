import {
  eventContactRetentionSchema,
  type EventContactRetention,
} from "../../../../assets/shared/schemas/event-contact-retention";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
/** Existing configured profile window supplies a contact deadline, never an evidence-purge deadline. */
const contactDeadline =
  "strftime('%Y-%m-%dT%H:%M:%fZ',contact_event.ends_at,'+'||contact_policy.user_retention_days||' days')";
const deadlineConfigured = "contact_policy.event_id IS NOT NULL AND contact_event.ends_at IS NOT NULL";
/** Trusted canonical SQL column expression only; this function accepts no request text or bindings. */
export function eventContactAccessSql(eventIdExpression: string): string {
  if (!/^[a-z_]+\.[a-z_]+$/.test(eventIdExpression)) throw new Error("Invalid contact retention event SQL expression");
  return `EXISTS(SELECT 1 FROM events contact_event
    LEFT JOIN retention_policies contact_policy ON contact_policy.event_id=contact_event.id
    LEFT JOIN event_contact_retention_state contact_state ON contact_state.event_id=contact_event.id
    WHERE contact_event.id=${eventIdExpression} AND contact_state.closed_at IS NULL
    AND (NOT (${deadlineConfigured}) OR (${contactDeadline} IS NOT NULL AND julianday(${contactDeadline})>julianday('now'))))`;
}
/** An unset policy/end is explicit; no guessed duration, date or global account redaction. */
export async function readEventContactRetention(db: DatabaseLike, eventId: string): Promise<EventContactRetention> {
  const row = await first<{ state: string; contactUntil: string | null; closedAt: string | null }>(
    db,
    `SELECT CASE WHEN contact_state.closed_at IS NOT NULL THEN 'closed'
      WHEN NOT (${deadlineConfigured}) THEN 'unconfigured'
      WHEN ${contactDeadline} IS NULL OR julianday(${contactDeadline})<=julianday('now') THEN 'closed' ELSE 'open' END AS state,
      COALESCE(contact_state.deadline_at,${contactDeadline}) AS contactUntil,COALESCE(contact_state.closed_at,CASE WHEN julianday(${contactDeadline})<=julianday('now') THEN ${contactDeadline} END) AS closedAt
      FROM events contact_event LEFT JOIN retention_policies contact_policy ON contact_policy.event_id=contact_event.id
      LEFT JOIN event_contact_retention_state contact_state ON contact_state.event_id=contact_event.id WHERE contact_event.id=?`,
    [eventId],
  );
  if (!row) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  return eventContactRetentionSchema.parse(row);
}
export async function assertEventContactAccess(db: DatabaseLike, eventId: string): Promise<EventContactRetention> {
  const policy = await readEventContactRetention(db, eventId);
  if (policy.state === "closed")
    throw new AppError(
      410,
      "EVENT_CONTACT_RETENTION_EXPIRED",
      "Contact access for this event has expired. Aggregate attendance reports remain available.",
    );
  return policy;
}
