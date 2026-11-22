/**
 * The settings of automatic checks: PKIC-wide per kind of content, and what
 * one event adds. Until staff save PKIC-wide settings the built-in questions
 * apply, so every check works from the start.
 */
import { DEFAULT_CONTENT_CHECK_SETTINGS } from "../../../../assets/shared/content-check-defaults";
import {
  CONTENT_CHECK_KINDS,
  effectiveContentCheck,
  type ContentCheckEventAdditions,
  type ContentCheckKind,
  type ContentCheckQuestion,
  type ContentCheckSettings,
  type EffectiveContentCheck,
} from "../../../../assets/shared/content-checks";
import {
  contentCheckModelSchema,
  contentCheckQuestionSchema,
  type ContentCheckEventAdditionsInput,
  type ContentCheckSettingsInput,
  type ContentCheckSettingsResponse,
  type EventContentCheckResponse,
} from "../../../../assets/shared/schemas/content-checks";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isStateGuardFailure, prepareStateGuard } from "../../db/authorization-guard";
import { batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import type { D1StatementResult, DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";

interface SettingsRow {
  kind: string;
  enabled: number;
  model: string;
  context: string;
  questions_json: string;
  revision: number;
  updated_at: string;
}

interface AdditionsRow {
  kind: string;
  context: string;
  questions_json: string;
  disabled_question_ids_json: string;
  revision: number;
  updated_at: string;
}

/** The PKIC-wide settings and what the event adds, for one kind or all kinds: one batch, two statements. */
export function prepareContentCheckSettingsRead(
  db: DatabaseLike,
  eventId: string | null,
  kind: ContentCheckKind | null,
): StatementLike[] {
  const kinds = kind ? [kind] : [...CONTENT_CHECK_KINDS];
  const list = kinds.map(() => "?").join(", ");
  return [
    db
      .prepare(
        `SELECT kind, enabled, model, context, questions_json, revision, updated_at
         FROM content_check_settings WHERE kind IN (${list})`,
      )
      .bind(...kinds),
    db
      .prepare(
        `SELECT kind, context, questions_json, disabled_question_ids_json, revision, updated_at
         FROM event_content_check_additions WHERE event_id = ? AND kind IN (${list})`,
      )
      .bind(eventId ?? "", ...kinds),
  ];
}

/** Stored questions are read through the shared schema; one that no longer parses is left out rather than run. */
function decodeQuestions(json: string): ContentCheckQuestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((question) => {
    const result = contentCheckQuestionSchema.safeParse(question);
    return result.success ? [result.data as ContentCheckQuestion] : [];
  });
}

function decodeIds(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function settingsResponse(kind: ContentCheckKind, row: SettingsRow | undefined): ContentCheckSettingsResponse {
  if (!row) return { kind, revision: 0, saved: false, updatedAt: null, ...DEFAULT_CONTENT_CHECK_SETTINGS[kind] };
  const model = contentCheckModelSchema.safeParse(row.model);
  return {
    kind,
    revision: row.revision,
    saved: true,
    updatedAt: row.updated_at,
    enabled: row.enabled === 1,
    model: model.success ? model.data : DEFAULT_CONTENT_CHECK_SETTINGS[kind].model,
    context: row.context,
    questions: decodeQuestions(row.questions_json),
  };
}

export interface DecodedContentCheckSettings {
  settings: Map<ContentCheckKind, ContentCheckSettingsResponse>;
  additions: Map<ContentCheckKind, ContentCheckEventAdditions & { revision: number; updatedAt: string | null }>;
}

export function decodeContentCheckSettings(
  results: readonly D1StatementResult[],
  kinds: readonly ContentCheckKind[] = CONTENT_CHECK_KINDS,
): DecodedContentCheckSettings {
  const settingsRows = new Map(batchRows<SettingsRow>(results[0]!).map((row) => [row.kind, row]));
  const additionRows = new Map(batchRows<AdditionsRow>(results[1]!).map((row) => [row.kind, row]));
  const settings = new Map<ContentCheckKind, ContentCheckSettingsResponse>();
  const additions: DecodedContentCheckSettings["additions"] = new Map();
  for (const kind of kinds) {
    settings.set(kind, settingsResponse(kind, settingsRows.get(kind)));
    const row = additionRows.get(kind);
    additions.set(
      kind,
      row
        ? {
            revision: row.revision,
            updatedAt: row.updated_at,
            context: row.context,
            questions: decodeQuestions(row.questions_json),
            disabledQuestionIds: decodeIds(row.disabled_question_ids_json),
          }
        : { revision: 0, updatedAt: null, context: "", questions: [], disabledQuestionIds: [] },
    );
  }
  return { settings, additions };
}

function asSettings(response: ContentCheckSettingsResponse): ContentCheckSettings {
  return { enabled: response.enabled, model: response.model, context: response.context, questions: response.questions };
}

export function effectiveCheckFrom(
  decoded: DecodedContentCheckSettings,
  kind: ContentCheckKind,
): EffectiveContentCheck {
  return effectiveContentCheck(asSettings(decoded.settings.get(kind)!), decoded.additions.get(kind) ?? null);
}

/** The check as it runs for an event, or PKIC-wide when there is no event. */
export async function readEffectiveContentCheck(
  db: DatabaseLike,
  eventId: string | null,
  kind: ContentCheckKind,
): Promise<EffectiveContentCheck> {
  const results = await db.batch(prepareContentCheckSettingsRead(db, eventId, kind));
  return effectiveCheckFrom(decodeContentCheckSettings(results, [kind]), kind);
}

export async function listContentCheckSettings(db: DatabaseLike): Promise<ContentCheckSettingsResponse[]> {
  const results = await db.batch(prepareContentCheckSettingsRead(db, null, null));
  const decoded = decodeContentCheckSettings(results);
  return CONTENT_CHECK_KINDS.map((kind) => decoded.settings.get(kind)!);
}

export async function readEventContentCheck(
  db: DatabaseLike,
  eventId: string,
  kind: ContentCheckKind,
): Promise<EventContentCheckResponse> {
  const results = await db.batch(prepareContentCheckSettingsRead(db, eventId, kind));
  const decoded = decodeContentCheckSettings(results, [kind]);
  const additions = decoded.additions.get(kind)!;
  return {
    kind,
    settings: decoded.settings.get(kind)!,
    additions,
    effective: effectiveCheckFrom(decoded, kind),
  };
}

function changedError(): AppError {
  return new AppError(
    409,
    "CONTENT_CHECK_CHANGED",
    "These settings changed while you were editing. Reload and try again.",
  );
}

async function commit(db: DatabaseLike, statements: StatementLike[]): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    if (isStateGuardFailure(error)) throw changedError();
    throw error;
  }
}

/** Saves the PKIC-wide settings for one kind. Staff with global event management change them. */
export async function saveContentCheckSettings(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  kind: ContentCheckKind,
  input: ContentCheckSettingsInput,
): Promise<{ revision: number }> {
  const now = nowIso();
  await commit(db, [
    preparePermissionsAuthorizationGuard(db, actor, [{ permission: "events:manage" }]),
    prepareStateGuard(db, {
      sql: "SELECT 1 WHERE COALESCE((SELECT revision FROM content_check_settings WHERE kind = ?), 0) = ?",
      bindings: [kind, input.expectedRevision],
    }),
    db
      .prepare(
        `INSERT INTO content_check_settings (kind, enabled, model, context, questions_json, revision, updated_by_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET enabled = excluded.enabled, model = excluded.model, context = excluded.context,
           questions_json = excluded.questions_json, revision = content_check_settings.revision + 1,
           updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
      )
      .bind(kind, input.enabled ? 1 : 0, input.model, input.context, JSON.stringify(input.questions), actor.id, now),
    prepareAuditLog(db, "user", actor.id, "content_check_settings_changed", "content_check", kind, {
      enabled: input.enabled,
      model: input.model,
      questions: input.questions.map((question) => question.id),
    }),
  ]);
  return { revision: input.expectedRevision + 1 };
}

/** Saves what one event adds to a check. Event managers change them. */
export async function saveEventContentCheckAdditions(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventId: string,
  kind: ContentCheckKind,
  input: ContentCheckEventAdditionsInput,
): Promise<{ revision: number }> {
  const now = nowIso();
  await commit(db, [
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "events:write", context: { type: "event", id: eventId } },
    ]),
    prepareStateGuard(db, {
      sql: `SELECT 1 WHERE COALESCE((SELECT revision FROM event_content_check_additions WHERE event_id = ? AND kind = ?), 0) = ?`,
      bindings: [eventId, kind, input.expectedRevision],
    }),
    db
      .prepare(
        `INSERT INTO event_content_check_additions
           (event_id, kind, context, questions_json, disabled_question_ids_json, revision, updated_by_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(event_id, kind) DO UPDATE SET context = excluded.context, questions_json = excluded.questions_json,
           disabled_question_ids_json = excluded.disabled_question_ids_json,
           revision = event_content_check_additions.revision + 1,
           updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
      )
      .bind(
        eventId,
        kind,
        input.context,
        JSON.stringify(input.questions),
        JSON.stringify(input.disabledQuestionIds),
        actor.id,
        now,
      ),
    prepareAuditLog(db, "user", actor.id, "event_content_check_changed", "event", eventId, {
      kind,
      questions: input.questions.map((question) => question.id),
      disabledQuestionIds: input.disabledQuestionIds,
    }),
  ]);
  return { revision: input.expectedRevision + 1 };
}
