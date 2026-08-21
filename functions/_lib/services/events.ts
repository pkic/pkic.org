import { AppError } from "../errors";
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import { uuid } from "../utils/ids";
import { prepareAuditLog } from "./audit";
import type { DatabaseLike, StatementLike } from "../types";
import { EVENT_COLUMNS, type EventRecord, type EventTermRecord } from "./event-types";

export { EVENT_COLUMNS } from "./event-types";
export type { EventRecord, EventTermRecord } from "./event-types";
export * from "./event-presentation";

export async function getEventBySlug(db: DatabaseLike, slug: string): Promise<EventRecord> {
  const event = await first<EventRecord>(db, `SELECT ${EVENT_COLUMNS} FROM events WHERE slug = ?`, [slug]);
  if (!event) {
    throw new AppError(404, "EVENT_NOT_FOUND", `Event '${slug}' not found`);
  }
  return event;
}

export async function eventSlugExists(db: DatabaseLike, slug: string): Promise<boolean> {
  return (await first<{ id: string }>(db, "SELECT id FROM events WHERE slug = ?", [slug])) !== null;
}

export async function getEventById(db: DatabaseLike, eventId: string): Promise<EventRecord> {
  const event = await first<EventRecord>(db, `SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`, [eventId]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  return event;
}

export async function getRequiredTerms(
  db: DatabaseLike,
  eventId: string,
  audienceType: "attendee" | "speaker" | "presentation",
): Promise<EventTermRecord[]> {
  return all<EventTermRecord>(
    db,
    `SELECT term_key, version, required, content_ref
            , display_text, help_text
     FROM event_terms
     WHERE event_id = ? AND audience_type = ? AND active = 1
     ORDER BY term_key ASC`,
    [eventId, audienceType],
  );
}

export interface EventUpsertPayload {
  slug: string;
  name: string;
  timezone: string;
  startsAt?: string | null;
  endsAt?: string | null;
  registrationMode?: string;
  inviteLimitAttendee?: number;
  inviteLimitSpeakerNomination?: number;
  settings?: Record<string, unknown>;
}

export interface EventSyncTerms {
  attendee: EventTermInput[];
  speaker: EventTermInput[];
}

interface EventTermInput {
  termKey: string;
  version: string;
  required?: boolean;
  contentRef?: string;
  displayText?: string;
}

async function buildEventUpsertStatement(
  db: DatabaseLike,
  payload: EventUpsertPayload,
): Promise<{ eventId: string; statement: StatementLike }> {
  const existing = await first<EventRecord>(db, `SELECT ${EVENT_COLUMNS} FROM events WHERE slug = ?`, [payload.slug]);
  const now = nowIso();

  if (!existing) {
    const event: EventRecord = {
      id: uuid(),
      slug: payload.slug,
      name: payload.name,
      timezone: payload.timezone,
      starts_at: payload.startsAt ?? null,
      ends_at: payload.endsAt ?? null,
      source_path: null,
      base_path: null, // Set on first frontend submission via updateEventBasePath
      capacity_in_person: null,
      registration_mode: payload.registrationMode ?? "invite_or_open",
      invite_limit_attendee: payload.inviteLimitAttendee ?? 50,
      invite_limit_speaker_nomination: payload.inviteLimitSpeakerNomination ?? 10,
      settings_json: stringifyJson(payload.settings ?? {}),
    };

    return {
      eventId: event.id,
      statement: db
        .prepare(
          `INSERT INTO events (
            id, slug, name, timezone, starts_at, ends_at, source_path, base_path, capacity_in_person,
            registration_mode, invite_limit_attendee, invite_limit_speaker_nomination, settings_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          event.id,
          event.slug,
          event.name,
          event.timezone,
          event.starts_at,
          event.ends_at,
          event.source_path,
          event.base_path,
          event.capacity_in_person,
          event.registration_mode,
          event.invite_limit_attendee,
          event.invite_limit_speaker_nomination,
          event.settings_json,
          now,
          now,
        ),
    };
  }

  return {
    eventId: existing.id,
    statement: db
      .prepare(
        `UPDATE events
         SET name = ?, timezone = ?, starts_at = ?, ends_at = ?,
             capacity_in_person = ?, registration_mode = ?, invite_limit_attendee = ?,
             invite_limit_speaker_nomination = ?, settings_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        payload.name,
        payload.timezone,
        payload.startsAt ?? existing.starts_at,
        payload.endsAt ?? existing.ends_at,
        null,
        payload.registrationMode ?? existing.registration_mode,
        payload.inviteLimitAttendee ?? existing.invite_limit_attendee,
        payload.inviteLimitSpeakerNomination ?? existing.invite_limit_speaker_nomination,
        stringifyJson({
          ...parseJsonSafe<Record<string, unknown>>(existing.settings_json, {}),
          ...(payload.settings ?? {}),
        }),
        now,
        existing.id,
      ),
  };
}

export async function upsertEventFromHugo(db: DatabaseLike, payload: EventUpsertPayload): Promise<EventRecord> {
  const mutation = await buildEventUpsertStatement(db, payload);
  await mutation.statement.run();

  return getEventBySlug(db, payload.slug);
}

export async function createAdminEvent(
  db: DatabaseLike,
  payload: EventUpsertPayload,
  actorUserId: string,
): Promise<EventRecord> {
  if (await eventSlugExists(db, payload.slug)) {
    throw new AppError(409, "SLUG_TAKEN", `The slug '${payload.slug}' is already in use`);
  }

  const mutation = await buildEventUpsertStatement(db, payload);
  await db.batch([
    mutation.statement,
    prepareAuditLog(db, "admin", actorUserId, "event_created", "event", mutation.eventId, {
      slug: payload.slug,
    }),
  ]);

  return getEventBySlug(db, payload.slug);
}

/** Allowed characters in a base path: letters, digits, hyphens, underscores, dots, slashes. */
const BASE_PATH_RE = /^\/[a-zA-Z0-9/_\-.]+\/$/;

/**
 * Records the canonical frontend base path for an event, sent by Hugo via
 * the X-Event-Base-Path request header on the first registration or proposal
 * submission.
 *
 * Only updates if the provided path is valid (relative, same-origin) and the
 * event does not already have a base_path recorded, so it cannot be overwritten
 * by a manipulated browser request after the fact.
 */
export async function updateEventBasePath(
  db: DatabaseLike,
  eventId: string,
  rawPath: string | null | undefined,
): Promise<void> {
  if (!rawPath) return;
  const path = rawPath.trim();
  if (!BASE_PATH_RE.test(path)) return; // reject malformed or external paths
  await run(db, "UPDATE events SET base_path = ? WHERE id = ? AND base_path IS NULL", [path, eventId]);
}

function buildReplaceEventTermsStatements(
  db: DatabaseLike,
  eventId: string,
  audienceType: "attendee" | "speaker",
  terms: EventTermInput[],
): StatementLike[] {
  const now = nowIso();
  return [
    db
      .prepare("UPDATE event_terms SET active = 0 WHERE event_id = ? AND audience_type = ?")
      .bind(eventId, audienceType),
    ...terms.map((term) =>
      db
        .prepare(
          `INSERT INTO event_terms (
            id, event_id, audience_type, term_key, version, required, content_ref, display_text, active, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(event_id, audience_type, term_key, version)
          DO UPDATE SET required = excluded.required, content_ref = excluded.content_ref, display_text = excluded.display_text, active = 1`,
        )
        .bind(
          uuid(),
          eventId,
          audienceType,
          term.termKey,
          term.version,
          term.required === false ? 0 : 1,
          term.contentRef ?? null,
          term.displayText ?? null,
          now,
        ),
    ),
  ];
}

export async function replaceEventTerms(
  db: DatabaseLike,
  eventId: string,
  audienceType: "attendee" | "speaker",
  terms: EventTermInput[],
): Promise<void> {
  await db.batch(buildReplaceEventTermsStatements(db, eventId, audienceType, terms));
}

export async function syncEventFromHugo(
  db: DatabaseLike,
  payload: EventUpsertPayload,
  terms: EventSyncTerms | undefined,
  actorUserId: string,
): Promise<EventRecord> {
  const mutation = await buildEventUpsertStatement(db, payload);
  const statements: StatementLike[] = [mutation.statement];
  if (terms) {
    statements.push(
      ...buildReplaceEventTermsStatements(db, mutation.eventId, "attendee", terms.attendee),
      ...buildReplaceEventTermsStatements(db, mutation.eventId, "speaker", terms.speaker),
    );
  }
  statements.push(
    prepareAuditLog(db, "admin", actorUserId, "event_synced_from_hugo", "event", mutation.eventId, {
      slug: payload.slug,
    }),
  );
  await db.batch(statements);
  return getEventBySlug(db, payload.slug);
}
