/**
 * Unfinished registrations: recorded when a signed-in person starts filling
 * in the registration form of any event, reminded on a fixed schedule until they register or say they
 * will not, and summarized for the organizers with the reasons people gave.
 */
import { nextUnfinishedRegistrationReminderAt } from "../../../../assets/shared/unfinished-registrations";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  unfinishedRegistrationNoteListSchema,
  type OwnUnfinishedRegistration,
  type UnfinishedRegistrationNote,
  type UnfinishedRegistrationNoteListQuery,
  type UnfinishedRegistrationStop,
  type UnfinishedRegistrationSummary,
} from "../../../../assets/shared/schemas/unfinished-registrations";
import { batchFirst, queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import {
  isAuthorizationGuardFailure,
  isStateGuardFailure,
  prepareAuthorizationGuard,
  prepareStateGuard,
  type AuthorizationEvidence,
} from "../../db/authorization-guard";
import { accountAddressSignsInSql, liveAccountSql } from "../../auth/email-sign-in-policy";
import { all, first } from "../../db/queries";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { normalizeEmail } from "../../validation";
import type { EventRecord } from "../events";
import { eventAudienceEvidenceById } from "../events/visibility";
import { registrationPageUrl } from "../frontend-links";

const HAS_REGISTRATION = `EXISTS (
  SELECT 1 FROM registrations registration
  WHERE registration.event_id = unfinished.event_id AND registration.user_id = unfinished.user_id
    AND registration.status <> 'cancelled')`;

/** Where a person says they will not register, in the portal. */
export function notRegisteringPageUrl(appBaseUrl: string, eventSlug: string): string {
  return `${appBaseUrl}/portal/#/events/${encodeURIComponent(eventSlug)}/not-registering`;
}

/** Records that the signed-in person started registering for the event. */
export async function startUnfinishedRegistration(
  db: DatabaseLike,
  event: Pick<EventRecord, "id">,
  userId: string,
  audienceEvidence: AuthorizationEvidence,
  sessionEvidence: AuthorizationEvidence,
): Promise<void> {
  try {
    await db.batch([
      prepareAuthorizationGuard(db, sessionEvidence),
      prepareStateGuard(db, audienceEvidence),
      prepareRegistrationStart(db, event.id, userId, nowIso()),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) throw new AppError(401, "AUTH_REQUIRED", "Sign in again to register.");
    if (isStateGuardFailure(error))
      throw new AppError(404, "EVENT_NOT_FOUND", "Event not found or not visible to this caller");
    throw error;
  }
}

/** Records that the person started registering, once, unless they are registered already. */
export function prepareRegistrationStart(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  now: string,
): StatementLike {
  return db
    .prepare(
      `INSERT INTO unfinished_registrations (event_id, user_id, started_at, next_reminder_at)
       SELECT ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM registrations WHERE event_id = ? AND user_id = ? AND status <> 'cancelled')
       ON CONFLICT(event_id, user_id) DO NOTHING`,
    )
    .bind(eventId, userId, now, nextUnfinishedRegistrationReminderAt(now, 0), eventId, userId);
}

type DueRow = Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json" | "source_mode" | "visibility"> & {
  event_id: string;
  user_id: string;
  event_name: string;
  email: string;
  started_at: string;
  reminders_sent: number;
  /** The person registered, the event no longer takes registrations, or it is over. */
  settled: number;
};

/** Sends the reminders that are due. One that no longer applies is cleared instead of sent. */
export async function sendUnfinishedRegistrationReminders(
  db: DatabaseLike,
  appBaseUrl: string,
  limit = 50,
): Promise<{ reminded: number; cleared: number }> {
  const now = nowIso();
  const due = await all<DueRow>(
    db,
    `SELECT unfinished.event_id, unfinished.user_id, unfinished.started_at, unfinished.reminders_sent,
            event.name AS event_name, event.slug, event.base_path, event.starts_at, event.settings_json,
            event.source_mode, event.visibility, person.email,
            (${HAS_REGISTRATION}
              OR event.registration_mode IN ('no_registration', 'automatic')
              OR datetime(COALESCE(event.ends_at, event.starts_at)) <= datetime(?)
              OR datetime(CASE WHEN json_valid(event.settings_json)
                   THEN COALESCE(json_extract(event.settings_json, '$.registration.closesAt'),
                                 json_extract(event.settings_json, '$.registrationClosesAt')) END) <= datetime(?)
            ) AS settled
     FROM unfinished_registrations unfinished
     JOIN events event ON event.id = unfinished.event_id
     JOIN users person ON person.id = unfinished.user_id
     WHERE unfinished.next_reminder_at IS NOT NULL AND unfinished.next_reminder_at <= ?
       AND unfinished.stopped_at IS NULL
     ORDER BY unfinished.next_reminder_at, unfinished.event_id, unfinished.user_id LIMIT ?`,
    [now, now, now, limit],
  );
  let reminded = 0;
  let cleared = 0;
  for (const row of due) {
    const key = [row.event_id, row.user_id];
    if (row.settled) {
      await db
        .prepare("UPDATE unfinished_registrations SET next_reminder_at = NULL WHERE event_id = ? AND user_id = ?")
        .bind(...key)
        .run();
      cleared += 1;
      continue;
    }
    const registerUrl = registrationPageUrl(appBaseUrl, row, { source: "unfinished_registration" });
    const stopUrl = notRegisteringPageUrl(appBaseUrl, row.slug);
    const audience = eventAudienceEvidenceById(row.event_id, { userId: row.user_id });
    const recipient: AuthorizationEvidence = {
      sql: `SELECT 1 FROM (SELECT 1) recipient_anchor JOIN users person
            ON person.id = ? AND ${liveAccountSql("person")}
              AND person.normalized_email = ?
              AND ${accountAddressSignsInSql("person.id", "person.normalized_email")}`,
      bindings: [row.user_id, normalizeEmail(row.email)],
    };
    try {
      await db.batch([
        prepareStateGuard(db, audience),
        prepareStateGuard(db, recipient),
        // The reminder goes out only if nobody else sent this one and the person has not answered since.
        prepareStateGuard(db, {
          sql: `SELECT 1 FROM unfinished_registrations unfinished
                WHERE unfinished.event_id = ? AND unfinished.user_id = ? AND unfinished.reminders_sent = ?
                  AND unfinished.stopped_at IS NULL AND NOT ${HAS_REGISTRATION}`,
          bindings: [...key, row.reminders_sent],
        }),
        db
          .prepare(
            `UPDATE unfinished_registrations SET reminders_sent = reminders_sent + 1, next_reminder_at = ?
             WHERE event_id = ? AND user_id = ? AND reminders_sent = ?`,
          )
          .bind(
            nextUnfinishedRegistrationReminderAt(row.started_at, row.reminders_sent + 1),
            ...key,
            row.reminders_sent,
          ),
        prepareQueueEmailStatement(db, {
          eventId: row.event_id,
          baseUrl: appBaseUrl,
          templateKey: "registration_unfinished_reminder",
          recipientEmail: row.email,
          recipientUserId: row.user_id,
          messageType: "transactional",
          outboxId: uuid(),
          idempotencyKey: `unfinished-registration:${row.event_id}:${row.user_id}:${row.reminders_sent + 1}`,
          data: {
            eventName: row.event_name,
            registerUrl,
            notRegisteringUrl: stopUrl,
            __currentRecipient: { userId: row.user_id, email: row.email, requireCurrentPrimary: true },
          },
        }).statement,
      ]);
      reminded += 1;
    } catch (error) {
      if (!isStateGuardFailure(error)) throw error;
      const [visible, eligible] = await db.batch([
        db.prepare(audience.sql).bind(...audience.bindings),
        db.prepare(recipient.sql).bind(...recipient.bindings),
      ]);
      if (!batchFirst(visible) || !batchFirst(eligible)) {
        const clearedRow = await db
          .prepare(`UPDATE unfinished_registrations SET next_reminder_at = NULL
                    WHERE event_id = ? AND user_id = ? AND reminders_sent = ? AND next_reminder_at IS NOT NULL`)
          .bind(...key, row.reminders_sent)
          .run();
        if (clearedRow.meta?.changes) cleared += 1;
      }
    }
  }
  return { reminded, cleared };
}

/** The signed-in person's own unfinished registration for the event. */
export async function readOwnUnfinishedRegistration(
  db: DatabaseLike,
  event: Pick<EventRecord, "id" | "name">,
  userId: string,
): Promise<OwnUnfinishedRegistration> {
  const row = await first<{ stopped_at: string | null; registered: number }>(
    db,
    `SELECT unfinished.stopped_at, ${HAS_REGISTRATION} AS registered
     FROM unfinished_registrations unfinished WHERE unfinished.event_id = ? AND unfinished.user_id = ?`,
    [event.id, userId],
  );
  const state = !row ? "none" : row.registered ? "registered" : row.stopped_at ? "stopped" : "unfinished";
  return { eventName: event.name, state };
}

/** The person says they will not register: reminders stop and their reason is kept for the organizers. */
export async function stopUnfinishedRegistration(
  db: DatabaseLike,
  event: Pick<EventRecord, "id">,
  userId: string,
  input: UnfinishedRegistrationStop,
): Promise<void> {
  const now = nowIso();
  // A reminder queued a moment ago and not sent yet is withdrawn with the answer.
  const reminderKeys = `unfinished-registration:${event.id}:${userId}:`;
  const [result] = await db.batch([
    db
      .prepare(
        `UPDATE unfinished_registrations
         SET stopped_at = ?, stop_reason = ?, stop_note = ?, next_reminder_at = NULL
         WHERE event_id = ? AND user_id = ?`,
      )
      .bind(now, input.reasonCode ?? null, input.reasonNote || null, event.id, userId),
    db
      .prepare(
        `UPDATE email_outbox SET status = 'cancelled', updated_at = ?
         WHERE status IN ('queued', 'retrying') AND idempotency_key >= ? AND idempotency_key < ?`,
      )
      .bind(now, reminderKeys, `${reminderKeys.slice(0, -1)};`),
  ]);
  if (!result?.meta?.changes)
    throw new AppError(404, "UNFINISHED_REGISTRATION_NOT_FOUND", "There is no unfinished registration to stop.");
}

/** A person who said no and registered after all counts as registered, not as stopped. */
const STOPPED_WITH_NOTE = `unfinished.stopped_at IS NOT NULL AND unfinished.stop_note IS NOT NULL AND NOT ${HAS_REGISTRATION}`;

/** How many people started, finished or stopped, and the reasons of those who stopped. */
export async function readUnfinishedRegistrationSummary(
  db: DatabaseLike,
  event: Pick<EventRecord, "id">,
): Promise<UnfinishedRegistrationSummary> {
  type Reason = UnfinishedRegistrationSummary["reasons"][number]["reasonCode"];
  const [totals, reasons] = await Promise.all([
    first<{
      started: number;
      registered: number;
      reminded: number;
      stopped: number;
      gave_reason: number;
      wrote_note: number;
    }>(
      db,
      `SELECT COUNT(*) AS started,
              COALESCE(SUM(${HAS_REGISTRATION}), 0) AS registered,
              COALESCE(SUM(unfinished.reminders_sent > 0), 0) AS reminded,
              COALESCE(SUM(unfinished.stopped_at IS NOT NULL AND NOT ${HAS_REGISTRATION}), 0) AS stopped,
              COALESCE(SUM(unfinished.stopped_at IS NOT NULL AND unfinished.stop_reason IS NOT NULL
                           AND NOT ${HAS_REGISTRATION}), 0) AS gave_reason,
              COALESCE(SUM(${STOPPED_WITH_NOTE}), 0) AS wrote_note
       FROM unfinished_registrations unfinished WHERE unfinished.event_id = ?`,
      [event.id],
    ),
    all<{ reason: Reason; count: number }>(
      db,
      `SELECT unfinished.stop_reason AS reason, COUNT(*) AS count FROM unfinished_registrations unfinished
       WHERE unfinished.event_id = ? AND unfinished.stopped_at IS NOT NULL AND NOT ${HAS_REGISTRATION}
       GROUP BY unfinished.stop_reason ORDER BY count DESC, unfinished.stop_reason`,
      [event.id],
    ),
  ]);
  return {
    started: totals?.started ?? 0,
    registered: totals?.registered ?? 0,
    reminded: totals?.reminded ?? 0,
    stopped: totals?.stopped ?? 0,
    gaveReason: totals?.gave_reason ?? 0,
    reasons: reasons.map((row) => ({ reasonCode: row.reason, count: row.count })),
    wroteNote: totals?.wrote_note ?? 0,
  };
}

/** What people wrote when they said they will not register, as a searched and paged collection. */
export async function listUnfinishedRegistrationNotes(
  db: DatabaseLike,
  event: Pick<EventRecord, "id">,
  query: UnfinishedRegistrationNoteListQuery,
) {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["unfinished.stop_note"]) : null;
  const { rows, total } = await queryPage<UnfinishedRegistrationNote>(db, {
    source: {
      selectSql:
        "SELECT unfinished.stop_reason AS reasonCode, unfinished.stop_note AS note, unfinished.stopped_at AS stoppedAt",
      fromSql: `FROM unfinished_registrations unfinished
                WHERE unfinished.event_id = ? AND ${STOPPED_WITH_NOTE}${search ? ` AND ${search.sql}` : ""}`,
      bindings: [event.id, ...(search?.bindings ?? [])],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { stoppedAt: "unfinished.stopped_at" },
      "unfinished.stopped_at DESC",
      "unfinished.user_id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return unfinishedRegistrationNoteListSchema.parse({
    notes: rows,
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
