/**
 * What invited calendars answer about a meeting occurrence (#126).
 *
 * A reply arrives the way a conference RSVP does — through the signed
 * organizer address, or the signed webhook — and names the occurrence by the
 * id the address was signed over. One row per (occurrence, attendee) holds
 * the latest answer; a repeated delivery of the same reply changes nothing.
 */
import type { z } from "zod";
import {
  EVENT_OCCURRENCE_INVITATION_SORT_COLUMNS,
  type eventOccurrenceInvitationsListQuerySchema,
} from "../../../../assets/shared/schemas/meeting-invitations";
import { queryPage } from "../../db/pagination";
import { first, run } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { getManagedSeriesOccurrence } from "./occurrences";

type InvitationsListQuery = z.infer<typeof eventOccurrenceInvitationsListQuerySchema>;

export type OccurrenceRsvpStatus = "accepted" | "declined" | "tentative" | "bounced";

export interface OccurrenceRsvpInput {
  occurrenceId: string;
  attendeeEmail: string;
  responseStatus: OccurrenceRsvpStatus;
  provider: string;
  sourceMessageId: string;
  receivedAt?: string;
}

/** Whether an id names a meeting occurrence rather than a registration. */
export async function isOccurrenceId(db: DatabaseLike, id: string): Promise<boolean> {
  return Boolean(await first<{ id: string }>(db, "SELECT id FROM event_occurrences WHERE id = ?", [id]));
}

/** Records the latest answer from one attendee's calendar, idempotently. */
export async function recordOccurrenceRsvp(db: DatabaseLike, input: OccurrenceRsvpInput): Promise<void> {
  const receivedAt = input.receivedAt ?? nowIso();
  const attendeeEmail = input.attendeeEmail.trim().toLowerCase();
  const { changes } = await run(
    db,
    `INSERT INTO event_occurrence_rsvps
       (id, occurrence_id, attendee_email, user_id, response_status, provider, source_message_id,
        received_at, created_at, updated_at)
     SELECT ?, occurrence.id, ?,
            (SELECT invited.user_id FROM meeting_occurrence_invitations invited
              WHERE invited.occurrence_id = ? AND invited.recipient_email = ?
              LIMIT 1),
            ?, ?, ?, ?, ?, ?
       FROM event_occurrences occurrence
      WHERE occurrence.id = ?
     ON CONFLICT(occurrence_id, attendee_email) DO UPDATE SET
       response_status = CASE WHEN excluded.received_at >= event_occurrence_rsvps.received_at
                              THEN excluded.response_status ELSE event_occurrence_rsvps.response_status END,
       provider = excluded.provider,
       source_message_id = excluded.source_message_id,
       received_at = MAX(excluded.received_at, event_occurrence_rsvps.received_at),
       updated_at = excluded.updated_at`,
    [
      uuid(),
      attendeeEmail,
      input.occurrenceId,
      attendeeEmail,
      input.responseStatus,
      input.provider,
      input.sourceMessageId,
      receivedAt,
      receivedAt,
      receivedAt,
      input.occurrenceId,
    ],
  );
  if (changes !== 1) throw new AppError(404, "EVENT_OCCURRENCE_NOT_FOUND", "Meeting occurrence not found");
}

interface InvitationRow {
  user_id: string | null;
  name: string;
  email: string;
  sent_at: string;
  response: OccurrenceRsvpStatus | null;
  responded_at: string | null;
}

const INVITATION_SORTS = {
  name: "invitation.name COLLATE NOCASE",
  sent_at: "invitation.sent_at",
  response: "COALESCE(invitation.response, 'zz')",
} satisfies Record<(typeof EVENT_OCCURRENCE_INVITATION_SORT_COLUMNS)[number], string>;

/** Everyone invited to the occurrence, with the latest answer from their calendar. */
export async function listOccurrenceInvitations(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  query: InvitationsListQuery,
) {
  await getManagedSeriesOccurrence(db, actor, groupIdOrSlug, seriesId, occurrenceId);
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (query.response === "none") conditions.push("invitation.response IS NULL");
  else if (query.response) {
    conditions.push("invitation.response = ?");
    bindings.push(query.response);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["invitation.name", "invitation.email"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const fromSql = `FROM (
      SELECT invited.user_id AS user_id,
             invited.recipient_name AS name,
             invited.recipient_email AS email,
             MAX(invited.sent_at) AS sent_at,
             COALESCE(rsvp.response_status, series_rsvp.response_status) AS response,
             COALESCE(rsvp.received_at, series_rsvp.received_at) AS responded_at
        FROM meeting_occurrence_invitations invited
        JOIN event_occurrences occurrence ON occurrence.id = invited.occurrence_id
        LEFT JOIN event_series_rsvps series_rsvp ON series_rsvp.series_id = occurrence.series_id AND series_rsvp.attendee_email = invited.recipient_email
        LEFT JOIN event_occurrence_rsvps rsvp
          ON rsvp.occurrence_id = ? AND rsvp.attendee_email = invited.recipient_email
       WHERE invited.occurrence_id = ?
       GROUP BY invited.recipient_email
    ) invitation${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}`;
  const { rows, total } = await queryPage<InvitationRow>(db, {
    source: {
      selectSql:
        "SELECT invitation.user_id, invitation.name, invitation.email, invitation.sent_at, invitation.response, invitation.responded_at",
      fromSql,
      bindings: [occurrenceId, occurrenceId, ...bindings],
    },
    orderBy: resolveMappedOrderBy(query.sort, INVITATION_SORTS, "invitation.name COLLATE NOCASE", "invitation.email"),
    limit: query.limit,
    offset: query.offset,
  });
  return {
    invitations: rows.map((row) => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      sentAt: row.sent_at,
      response: row.response,
      respondedAt: row.responded_at,
    })),
    total,
  };
}
