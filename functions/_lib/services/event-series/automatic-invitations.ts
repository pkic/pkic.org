/** Durable, bounded delivery of one recurring calendar per participant. */
import {
  MEETING_CALENDAR_OCCURRENCE_LIMIT,
  MEETING_CALENDAR_RECIPIENT_PAGE,
  outboundMeetingLocation,
} from "../../../../assets/shared/meeting-calendar-policy";
import { prepareBulkQueueEmailChunkStatements, processPendingOutboxBackground } from "../../email/outbox";
import { emailPlainText } from "../../email/plain-text";
import { all, first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import { resolveAppBaseUrl } from "../../config";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { CALENDAR_OCCURRENCE_WINDOW_SQL, renewMeetingCalendars } from "./calendar-schedule";
import {
  buildSeriesCalendarPayload,
  prepareSeriesCalendarDefinition,
  seriesCalendarUrl,
  type SeriesCalendar,
  type SeriesCalendarOccurrence,
} from "./series-calendar";
import { occurrenceOrganizerAddress, type OccurrenceNotificationOptions } from "./occurrence-notifications";
import { memberMeetingLinkUrl, memberMeetingLinkUrls } from "./personal-entry-links";

export const AUTOMATIC_INVITATION_TEMPLATE_KEY = "meeting-series-invitation";
export interface AutomaticInvitationOptions extends Pick<OccurrenceNotificationOptions, "signingSecret" | "rsvpEmail"> {
  seriesId?: string;
}

/** Identity-backed active group participation, deduplicated by delivery address. */
const ELIGIBLE = `SELECT series.id AS series_id, MIN(participant.id) AS user_id,
  lower(COALESCE(seat_email.email, participant.email)) AS recipient_email,
  COALESCE(NULLIF(TRIM(COALESCE(participant.preferred_name, '')), ''),
    NULLIF(TRIM(COALESCE(participant.first_name, '') || ' ' || COALESCE(participant.last_name, '')), ''), participant.email) AS recipient_name
 FROM event_series series JOIN events event ON event.id = series.event_id
 JOIN group_memberships membership ON membership.group_id = event.owner_group_id AND membership.left_at IS NULL
 JOIN users participant ON participant.id = membership.user_id AND participant.active = 1
 JOIN members member ON member.id = membership.member_id AND member.status = 'active'
 JOIN identities identity ON identity.id = membership.identity_id AND identity.started_at IS NOT NULL
  AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
 LEFT JOIN user_emails seat_email ON seat_email.id = identity.email_id AND seat_email.user_id = participant.id AND seat_email.verified_at IS NOT NULL
 WHERE series.active = 1 AND event.registration_mode = 'automatic'
 AND participant.pii_redacted_at IS NULL AND participant.merged_into_user_id IS NULL
 GROUP BY series.id, lower(COALESCE(seat_email.email, participant.email))`;

interface Recipient {
  series_id: string;
  user_id: string | null;
  recipient_email: string;
  recipient_name: string;
  cancelled: number;
  previous_sequence: number;
  previous_notice_at: string | null;
}

export function automaticInvitationIdempotencyKey(seriesId: string, email: string, sequence = 1): string {
  return `meeting-series-invitation:${seriesId}:${email}:${sequence}`;
}

export async function runAutomaticMeetingInvitations(
  db: DatabaseLike,
  appBaseUrl: string,
  limit = MEETING_CALENDAR_RECIPIENT_PAGE,
  d1QueryBudget?: D1QueryBudget,
  options: AutomaticInvitationOptions = {},
): Promise<{ queued: number }> {
  if (limit <= 0 || !hasD1QueryCapacity(d1QueryBudget, 40)) return { queued: 0 };
  await renewMeetingCalendars(db, options.seriesId);
  // Missing signing must be visible and retryable; never send a calendar that cannot receive an RSVP.
  const now = nowIso();
  const recipients = await all<Recipient>(
    db,
    `WITH eligible AS (${ELIGIBLE}), owed AS (
    SELECT eligible.series_id, eligible.user_id, eligible.recipient_email, eligible.recipient_name, 0 AS cancelled, COALESCE(delivery.sequence, 0) AS previous_sequence, delivery.sent_at AS previous_notice_at
      FROM eligible JOIN event_series series ON series.id = eligible.series_id
      LEFT JOIN event_series_calendar_deliveries delivery ON delivery.series_id = eligible.series_id AND delivery.recipient_email = eligible.recipient_email
     WHERE (delivery.series_id IS NOT NULL OR EXISTS (SELECT 1 FROM event_occurrences occurrence WHERE occurrence.series_id = series.id AND occurrence.status = 'scheduled' AND occurrence.ends_at > ?))
       AND (delivery.series_id IS NULL OR delivery.revision < series.calendar_revision OR delivery.cancelled = 1)
    UNION ALL
    SELECT delivery.series_id, delivery.user_id, delivery.recipient_email, delivery.recipient_name, 1, delivery.sequence, delivery.sent_at
      FROM event_series_calendar_deliveries delivery
     WHERE delivery.cancelled = 0 AND NOT EXISTS (SELECT 1 FROM eligible WHERE eligible.series_id = delivery.series_id AND eligible.recipient_email = delivery.recipient_email)
  ) SELECT series_id, user_id, recipient_email, recipient_name, cancelled, previous_sequence, previous_notice_at FROM owed
    WHERE (? IS NULL OR series_id = ?) ORDER BY series_id, recipient_email LIMIT ?`,
    [
      now,
      options.seriesId ?? null,
      options.seriesId ?? null,
      Math.min(MEETING_CALENDAR_RECIPIENT_PAGE, Math.floor(limit)),
    ],
  );
  if (!recipients.length) return { queued: 0 };
  if (!options.signingSecret)
    throw new AppError(503, "EMAIL_SIGNING_NOT_CONFIGURED", "Meeting calendar RSVP signing is unavailable");
  // One series per transaction, keeping the calendar snapshot and its revision indivisible.
  const seriesId = recipients[0].series_id;
  const page = recipients.filter((row) => row.series_id === seriesId);
  const series = await first<SeriesCalendar>(
    db,
    `SELECT series.id, series.event_id, event.owner_group_id, owner.slug AS owner_group_slug,
    event.name AS event_name, series.starts_at, series.recurrence_rule, series.duration_minutes, series.timezone, series.location, series.calendar_revision, series.calendar_through
    FROM event_series series JOIN events event ON event.id = series.event_id
    JOIN groups owner ON owner.id = event.owner_group_id WHERE series.id = ?`,
    [seriesId],
  );
  if (!series) return { queued: 0 };
  const occurrences = await all<SeriesCalendarOccurrence & { updated_at: string }>(
    db,
    `SELECT occurrence.id, occurrence.starts_at, occurrence.updated_at,
    COALESCE(occurrence.recurrence_id, occurrence.starts_at) AS recurrence_id, occurrence.ends_at, occurrence.status,
    COALESCE(occurrence.location_override, series.location) AS location
    FROM event_occurrences occurrence JOIN event_series series ON series.id = occurrence.series_id
    WHERE series.id = ? AND ${CALENDAR_OCCURRENCE_WINDOW_SQL} ORDER BY recurrence_id LIMIT ?`,
    [seriesId, new Date(Date.parse(now) - 30 * 86400_000).toISOString(), MEETING_CALENDAR_OCCURRENCE_LIMIT + 1],
  );
  if (occurrences.length > MEETING_CALENDAR_OCCURRENCE_LIMIT)
    throw new AppError(422, "MEETING_CALENDAR_TOO_LARGE", "The calendar exceeds the supported occurrence horizon");
  const organizerEmail = (await occurrenceOrganizerAddress(seriesId, options))!;
  const personalLinks = await memberMeetingLinkUrls(
    db,
    seriesId,
    null,
    page.flatMap((recipient) =>
      recipient.user_id ? [{ userId: recipient.user_id, email: recipient.recipient_email }] : [],
    ),
    appBaseUrl,
    options.signingSecret,
  );
  const joinUrlFor = (recipient: Recipient) =>
    recipient.user_id
      ? memberMeetingLinkUrl(personalLinks, recipient.user_id, recipient.recipient_email)
      : seriesCalendarUrl(appBaseUrl, series);
  const deliveries = page.map((row) => ({
    ...row,
    sequence: Math.max(series.calendar_revision, row.previous_sequence + 1),
  }));
  const definition = prepareSeriesCalendarDefinition(series, now, occurrences);
  const outbox = prepareBulkQueueEmailChunkStatements(
    db,
    deliveries.map((row) => ({
      outboxId: uuid(),
      idempotencyKey: automaticInvitationIdempotencyKey(seriesId, row.recipient_email, row.sequence),
      templateKey: AUTOMATIC_INVITATION_TEMPLATE_KEY,
      eventId: series.event_id,
      recipientUserId: row.user_id,
      recipientEmail: row.recipient_email,
      subject: `${row.cancelled ? "Canceled: " : row.previous_sequence > 0 ? "Meeting updated: " : "Meeting calendar: "}${series.event_name}`,
      messageType: "transactional" as const,
      data: {
        recipientName: emailPlainText(row.recipient_name),
        isUpdate: row.previous_sequence > 0,
        location: emailPlainText(outboundMeetingLocation(series.location) ?? ""),
        durationMinutes: series.duration_minutes,
        timezone: series.timezone,
        changedOccurrences: row.previous_notice_at
          ? occurrences
              .filter((item) => item.updated_at >= row.previous_notice_at!)
              .map((item) => ({
                startsAt: item.starts_at,
                endsAt: item.ends_at,
                cancelled: item.status === "cancelled",
                location: emailPlainText(outboundMeetingLocation(item.location) ?? ""),
                moved: item.starts_at !== item.recurrence_id,
                originalStartsAt: item.recurrence_id,
              }))
          : [],
        cancelled: row.cancelled === 1,
        eventName: emailPlainText(series.event_name),
        startsAt:
          occurrences.find((item) => item.status === "scheduled" && item.starts_at > now)?.starts_at ??
          series.starts_at,
        joinUrl: joinUrlFor(row),
      },
      capabilityLinkValues: [joinUrlFor(row)],
      calendar: buildSeriesCalendarPayload({ ...series, calendar_revision: row.sequence }, occurrences, {
        definition,
        baseUrl: appBaseUrl,
        attendeeEmail: row.recipient_email,
        organizerEmail,
        joinUrl: joinUrlFor(row),
        cancelled: row.cancelled === 1,
        now,
      }),
      bounceAddress: organizerEmail,
    })),
    now,
  );
  await db.batch([
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM event_series WHERE id = ? AND calendar_revision = ?",
      bindings: [seriesId, series.calendar_revision],
    }),
    prepareAuthorizationGuard(db, {
      sql: `WITH eligible AS (${ELIGIBLE}) SELECT 1 WHERE NOT EXISTS (
        SELECT 1 FROM json_each(?) requested WHERE
        COALESCE((SELECT sequence FROM event_series_calendar_deliveries WHERE series_id = ? AND recipient_email = json_extract(requested.value, '$.recipient_email')), 0) != json_extract(requested.value, '$.previous_sequence')
        OR (EXISTS (SELECT 1 FROM eligible WHERE series_id = ? AND recipient_email = json_extract(requested.value, '$.recipient_email'))) = json_extract(requested.value, '$.cancelled'))`,
      bindings: [JSON.stringify(page), seriesId, seriesId],
    }),
    ...outbox.map((chunk) => chunk.statement),
    db
      .prepare(
        `INSERT INTO event_series_calendar_deliveries (series_id, recipient_email, user_id, recipient_name, revision, sequence, cancelled, sent_at)
      SELECT ?, json_extract(value, '$.recipient_email'), json_extract(value, '$.user_id'), json_extract(value, '$.recipient_name'), ?,
      json_extract(value, '$.sequence'), json_extract(value, '$.cancelled'), ? FROM json_each(?) WHERE 1
      ON CONFLICT(series_id, recipient_email) DO UPDATE SET user_id = excluded.user_id, recipient_name = excluded.recipient_name,
      revision = excluded.revision, sequence = excluded.sequence, cancelled = excluded.cancelled, sent_at = excluded.sent_at`,
      )
      .bind(seriesId, series.calendar_revision, now, JSON.stringify(deliveries)),
  ]);
  return { queued: page.length };
}

export async function queueAutomaticInvitationsForSeries(
  db: DatabaseLike,
  env: Pick<Env, "APP_BASE_URL" | "INTERNAL_SIGNING_SECRET" | "RSVP_EMAIL">,
  request: Request,
  seriesId: string,
): Promise<{ queued: number }> {
  return runAutomaticMeetingInvitations(
    db,
    resolveAppBaseUrl(env, request),
    MEETING_CALENDAR_RECIPIENT_PAGE,
    undefined,
    { seriesId, signingSecret: env.INTERNAL_SIGNING_SECRET, rsvpEmail: env.RSVP_EMAIL },
  );
}

/** Safe background acceleration: the persisted revision and scheduled job own retries. */
export async function deliverSeriesCalendar(
  db: DatabaseLike,
  env: Env,
  request: Request,
  seriesId: string,
): Promise<void> {
  const { queued } = await queueAutomaticInvitationsForSeries(db, env, request, seriesId);
  await processPendingOutboxBackground(db, env, Math.max(queued, MEETING_CALENDAR_RECIPIENT_PAGE));
}
