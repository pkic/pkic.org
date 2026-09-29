import { AppError } from "../errors";
import { all, first, run } from "../db/queries";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { nowIso } from "../utils/time";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import { uuid } from "../utils/ids";
import { prepareAuditLog } from "./audit";
import type { DatabaseLike, StatementLike } from "../types";
import { EVENT_COLUMNS, type EventRecord, type EventTermRecord } from "./event-types";
import type { EventVisibility } from "../../../assets/shared/schemas/event-series";
import type { EventImportSource } from "../../../assets/shared/schemas/event-imports";

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
  visibility?: EventVisibility;
  inviteLimitAttendee?: number;
  inviteLimitSpeakerNomination?: number;
  settings?: Record<string, unknown>;
  /** Only portal/integration event creation supplies group ownership metadata. */
  ownerGroupId?: string;
  profileKey?: string;
  sourceMode?: "hugo" | "portal" | "integration";
  /** Stable platform-owned route root for portal-created events. */
  basePath?: string | null;
  links?: readonly string[];
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

export function prepareEventCreateStatement(
  db: DatabaseLike,
  payload: EventUpsertPayload,
): { eventId: string; statement: StatementLike } {
  const now = nowIso();
  const eventId = uuid();
  return {
    eventId,
    statement: db
      .prepare(
        `INSERT INTO events (
          id, slug, name, timezone, starts_at, ends_at, source_path, base_path, capacity_in_person,
          registration_mode, visibility, invite_limit_attendee, invite_limit_speaker_nomination, settings_json, created_at, updated_at,
          owner_group_id, profile_key, source_mode, links_json
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        eventId,
        payload.slug,
        payload.name,
        payload.timezone,
        payload.startsAt ?? null,
        payload.endsAt ?? null,
        payload.basePath ?? null,
        payload.registrationMode ?? "invite_or_open",
        payload.visibility ?? "invitation_only",
        payload.inviteLimitAttendee ?? 50,
        payload.inviteLimitSpeakerNomination ?? 10,
        stringifyJson(payload.settings ?? {}),
        now,
        now,
        payload.ownerGroupId ?? null,
        payload.profileKey ?? null,
        payload.sourceMode ?? null,
        payload.links === undefined ? null : stringifyJson(payload.links),
      ),
  };
}

async function buildEventUpsertStatement(
  db: DatabaseLike,
  payload: EventUpsertPayload,
): Promise<{ eventId: string; statement: StatementLike }> {
  const existing = await first<EventRecord>(db, `SELECT ${EVENT_COLUMNS} FROM events WHERE slug = ?`, [payload.slug]);

  if (!existing) return prepareEventCreateStatement(db, payload);
  const now = nowIso();

  return {
    eventId: existing.id,
    statement: db
      .prepare(
        `UPDATE events
         SET name = ?, timezone = ?, starts_at = ?, ends_at = ?,
             capacity_in_person = ?, registration_mode = ?, visibility = ?, invite_limit_attendee = ?,
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
        payload.visibility ?? (existing.visibility as EventVisibility),
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

/** Allowed characters in a base path: letters, digits, hyphens, underscores, dots, slashes. */
const BASE_PATH_RE = /^\/[a-zA-Z0-9/_\-.]+\/$/;

/**
 * Records the compatibility frontend base path for a Hugo-authored event,
 * sent by its published page on the first registration or proposal submission.
 *
 * Portal-owned paths are platform-derived and must never trust an anonymous
 * browser header. The guarded update also preserves the first valid Hugo path.
 */
export async function recordHugoEventBasePath(
  db: DatabaseLike,
  event: Pick<EventRecord, "id" | "source_mode">,
  rawPath: string | null | undefined,
): Promise<void> {
  if (event.source_mode === "portal") return;
  if (!rawPath) return;
  const path = rawPath.trim();
  if (!BASE_PATH_RE.test(path)) return; // reject malformed or external paths
  await run(
    db,
    `UPDATE events
        SET base_path = ?
      WHERE id = ?
        AND base_path IS NULL
        AND COALESCE(source_mode, '') <> 'portal'`,
    [path, event.id],
  );
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

/**
 * Import an event definition from an external generator.
 *
 * The INSERT-versus-UPDATE decision is made from a read taken before the
 * batch, so the batch re-asserts that decision atomically:
 *
 * - an update binds the exact `updated_at` revision observed by that read, so
 *   a concurrent write aborts the import instead of silently overwriting it;
 * - an update also binds the import source, so an event owned by the portal or
 *   another generator can never be retargeted by a slug collision;
 * - a create relies on the unique slug index, and a lost race surfaces as a
 *   conflict rather than an unhandled constraint error.
 *
 * `db` is expected to already carry the caller's live permission guard, so
 * permission revocation between authorization and commit aborts the same batch.
 */
export async function importEvent(
  db: DatabaseLike,
  source: EventImportSource,
  payload: EventUpsertPayload,
  terms: EventSyncTerms | undefined,
  actorUserId: string,
): Promise<{ event: EventRecord; created: boolean }> {
  const existing = await first<EventRecord>(db, `SELECT ${EVENT_COLUMNS} FROM events WHERE slug = ?`, [payload.slug]);
  if (existing && existing.source_mode !== null && existing.source_mode !== source) {
    throw new AppError(
      409,
      "EVENT_SOURCE_CONFLICT",
      `Event '${payload.slug}' is owned by the '${existing.source_mode}' source and cannot be imported from '${source}'`,
    );
  }
  const mutation = await buildEventUpsertStatement(db, { ...payload, sourceMode: source });
  const statements: StatementLike[] = [];
  if (existing) {
    statements.push(
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM events
               WHERE id = ? AND updated_at = ?
                 AND (source_mode IS NULL OR source_mode = ?)`,
        bindings: [existing.id, existing.updated_at, source],
      }),
    );
  }
  statements.push(mutation.statement);
  if (terms) {
    statements.push(
      ...buildReplaceEventTermsStatements(db, mutation.eventId, "attendee", terms.attendee),
      ...buildReplaceEventTermsStatements(db, mutation.eventId, "speaker", terms.speaker),
    );
  }
  statements.push(
    prepareAuditLog(db, "admin", actorUserId, "event_imported", "event", mutation.eventId, {
      slug: payload.slug,
      source,
    }),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "EVENT_IMPORT_CONFLICT", "The event changed while this import was being prepared");
    }
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: events.slug")) {
      throw new AppError(409, "EVENT_IMPORT_CONFLICT", "The event changed while this import was being prepared");
    }
    throw error;
  }
  return { event: await getEventBySlug(db, payload.slug), created: !existing };
}
