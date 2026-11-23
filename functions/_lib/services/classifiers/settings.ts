/**
 * The settings of classifiers: PKIC-wide for all content and per kind of
 * content, and what one event adds. No question ships with the code: until
 * staff save PKIC-wide settings a kind is off, asks nothing and costs no model
 * call.
 */
import {
  CLASSIFIER_KINDS,
  CLASSIFIER_SHARED_SCOPE,
  DEFAULT_CLASSIFIER_MODEL,
  effectiveClassifier,
  mergedClassifierQuestions,
  wideClassifier,
  type ClassifierEventAdditions,
  type ClassifierKind,
  type ClassifierQuestion,
  type ClassifierSettings,
  type EffectiveClassifier,
} from "../../../../assets/shared/classifiers";
import {
  classifierModelSchema,
  classifierQuestionSchema,
  type ClassifierEventAdditionsInput,
  type ClassifierSettingsInput,
  type ClassifierSettingsListResponse,
  type ClassifierSettingsResponse,
  type ClassifierSharedSettingsInput,
  type ClassifierSharedSettingsResponse,
  type EventClassifierResponse,
} from "../../../../assets/shared/schemas/classifiers";
import { formatEventPlace } from "../../../../assets/shared/event-place";
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
  disabled_question_ids_json: string;
  revision: number;
  updated_at: string;
}

interface EventRow {
  name: string;
  city: string | null;
  country: string | null;
}

interface AdditionsRow {
  kind: string;
  context: string;
  questions_json: string;
  disabled_question_ids_json: string;
  revision: number;
  updated_at: string;
}

/**
 * The PKIC-wide settings with all content's, what the event adds and the event itself, for one kind or all kinds: one
 * batch, three statements.
 */
export function prepareClassifierSettingsRead(
  db: DatabaseLike,
  eventId: string | null,
  kind: ClassifierKind | null,
): StatementLike[] {
  const kinds = kind ? [kind] : [...CLASSIFIER_KINDS];
  const list = kinds.map(() => "?").join(", ");
  return [
    db
      .prepare(
        `SELECT kind, enabled, model, context, questions_json, disabled_question_ids_json, revision, updated_at
         FROM classifier_settings WHERE kind IN (?, ${list})`,
      )
      .bind(CLASSIFIER_SHARED_SCOPE, ...kinds),
    db
      .prepare(
        `SELECT kind, context, questions_json, disabled_question_ids_json, revision, updated_at
         FROM event_classifier_additions WHERE event_id = ? AND kind IN (${list})`,
      )
      .bind(eventId ?? "", ...kinds),
    db.prepare("SELECT name, city, country FROM events WHERE id = ?").bind(eventId ?? ""),
  ];
}

/** Stored questions are read through the shared schema; one that no longer parses is left out rather than run. */
function decodeQuestions(json: string): ClassifierQuestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((question) => {
    const result = classifierQuestionSchema.safeParse(question);
    return result.success ? [result.data as ClassifierQuestion] : [];
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

/** Before staff save anything a kind is off and has nothing to ask. */
function unsavedSettings(): ClassifierSettings {
  return { enabled: false, model: DEFAULT_CLASSIFIER_MODEL, context: "", questions: [] };
}

function settingsResponse(kind: ClassifierKind, row: SettingsRow | undefined): ClassifierSettingsResponse {
  if (!row) return { kind, revision: 0, saved: false, updatedAt: null, ...unsavedSettings(), disabledQuestionIds: [] };
  const model = classifierModelSchema.safeParse(row.model);
  return {
    kind,
    revision: row.revision,
    saved: true,
    updatedAt: row.updated_at,
    enabled: row.enabled === 1,
    model: model.success ? model.data : DEFAULT_CLASSIFIER_MODEL,
    context: row.context,
    questions: decodeQuestions(row.questions_json),
    disabledQuestionIds: decodeIds(row.disabled_question_ids_json),
  };
}

function sharedResponse(row: SettingsRow | undefined): ClassifierSharedSettingsResponse {
  if (!row) return { revision: 0, saved: false, updatedAt: null, context: "", questions: [] };
  return {
    revision: row.revision,
    saved: true,
    updatedAt: row.updated_at,
    context: row.context,
    questions: decodeQuestions(row.questions_json),
  };
}

export interface DecodedClassifierSettings {
  shared: ClassifierSharedSettingsResponse;
  settings: Map<ClassifierKind, ClassifierSettingsResponse>;
  additions: Map<ClassifierKind, ClassifierEventAdditions & { revision: number; updatedAt: string | null }>;
  /** What the event record says about the event, for the model's context; empty outside an event. */
  eventDescription: string;
}

/** The event's own description: its name and where it takes place, the only descriptive fields an event record holds. */
function describeEvent(row: EventRow | undefined): string {
  if (!row) return "";
  const place = formatEventPlace({ city: row.city, country: row.country });
  return `This is for the event "${row.name}"${place ? ` in ${place}` : ""}.`;
}

export function decodeClassifierSettings(
  results: readonly D1StatementResult[],
  kinds: readonly ClassifierKind[] = CLASSIFIER_KINDS,
): DecodedClassifierSettings {
  const settingsRows = new Map(batchRows<SettingsRow>(results[0]!).map((row) => [row.kind, row]));
  const additionRows = new Map(batchRows<AdditionsRow>(results[1]!).map((row) => [row.kind, row]));
  const settings = new Map<ClassifierKind, ClassifierSettingsResponse>();
  const additions: DecodedClassifierSettings["additions"] = new Map();
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
  const eventRow = results[2] ? batchRows<EventRow>(results[2])[0] : undefined;
  return {
    shared: sharedResponse(settingsRows.get(CLASSIFIER_SHARED_SCOPE)),
    settings,
    additions,
    eventDescription: describeEvent(eventRow),
  };
}

/** One kind's PKIC-wide check, all content included. */
function wideCheckFrom(decoded: DecodedClassifierSettings, kind: ClassifierKind): ClassifierSettings {
  return wideClassifier(decoded.shared, decoded.settings.get(kind)!);
}

export function effectiveCheckFrom(decoded: DecodedClassifierSettings, kind: ClassifierKind): EffectiveClassifier {
  return effectiveClassifier(
    wideCheckFrom(decoded, kind),
    decoded.additions.get(kind) ?? null,
    decoded.eventDescription,
  );
}

/** The check as it runs for an event, or PKIC-wide when there is no event. */
export async function readEffectiveClassifier(
  db: DatabaseLike,
  eventId: string | null,
  kind: ClassifierKind,
): Promise<EffectiveClassifier> {
  const results = await db.batch(prepareClassifierSettingsRead(db, eventId, kind));
  return effectiveCheckFrom(decodeClassifierSettings(results, [kind]), kind);
}

export async function listClassifierSettings(db: DatabaseLike): Promise<ClassifierSettingsListResponse> {
  const results = await db.batch(prepareClassifierSettingsRead(db, null, null));
  const decoded = decodeClassifierSettings(results);
  return { shared: decoded.shared, classifiers: CLASSIFIER_KINDS.map((kind) => decoded.settings.get(kind)!) };
}

export async function readEventClassifier(
  db: DatabaseLike,
  eventId: string,
  kind: ClassifierKind,
): Promise<EventClassifierResponse> {
  const results = await db.batch(prepareClassifierSettingsRead(db, eventId, kind));
  const decoded = decodeClassifierSettings(results, [kind]);
  const additions = decoded.additions.get(kind)!;
  return {
    kind,
    settings: wideCheckFrom(decoded, kind),
    additions,
    effective: effectiveCheckFrom(decoded, kind),
  };
}

function changedError(): AppError {
  return new AppError(
    409,
    "CLASSIFIER_CHANGED",
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

/** Refuses the save when a settings row changed since its revision was read. */
function prepareRevisionGuard(db: DatabaseLike, scope: string, revision: number): StatementLike {
  return prepareStateGuard(db, {
    sql: "SELECT 1 WHERE COALESCE((SELECT revision FROM classifier_settings WHERE kind = ?), 0) = ?",
    bindings: [scope, revision],
  });
}

interface SettingsWrite {
  enabled: boolean;
  model: string;
  context: string;
  questions: readonly ClassifierQuestion[];
  disabledQuestionIds: readonly string[];
}

function prepareSettingsWrite(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  scope: string,
  write: SettingsWrite,
): StatementLike[] {
  return [
    db
      .prepare(
        `INSERT INTO classifier_settings
           (kind, enabled, model, context, questions_json, disabled_question_ids_json, revision, updated_by_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET enabled = excluded.enabled, model = excluded.model, context = excluded.context,
           questions_json = excluded.questions_json, disabled_question_ids_json = excluded.disabled_question_ids_json,
           revision = classifier_settings.revision + 1,
           updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
      )
      .bind(
        scope,
        write.enabled ? 1 : 0,
        write.model,
        write.context,
        JSON.stringify(write.questions),
        JSON.stringify(write.disabledQuestionIds),
        actor.id,
        nowIso(),
      ),
    prepareAuditLog(db, "user", actor.id, "classifier_settings_changed", "classifier", scope, {
      enabled: write.enabled,
      model: write.model,
      questions: write.questions.map((question) => question.id),
      disabledQuestionIds: write.disabledQuestionIds,
    }),
  ];
}

/** The stored questions and revision of the PKIC-wide scopes named, for a save that turns some of them off. */
async function readScopeQuestions(
  db: DatabaseLike,
  scopes: readonly string[],
): Promise<Map<string, { revision: number; questions: ClassifierQuestion[]; disabledQuestionIds: string[] }>> {
  const rows = await db
    .prepare(
      `SELECT kind, questions_json, disabled_question_ids_json, revision FROM classifier_settings
       WHERE kind IN (${scopes.map(() => "?").join(", ")})`,
    )
    .bind(...scopes)
    .all<Pick<SettingsRow, "kind" | "questions_json" | "disabled_question_ids_json" | "revision">>();
  return new Map(
    (rows.results ?? []).map((row) => [
      row.kind,
      {
        revision: row.revision,
        questions: decodeQuestions(row.questions_json),
        disabledQuestionIds: decodeIds(row.disabled_question_ids_json),
      },
    ]),
  );
}

/** Saves what all content asks, which every kind reads first. Staff with global event management change it. */
export async function saveClassifierSharedSettings(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  input: ClassifierSharedSettingsInput,
): Promise<{ revision: number }> {
  await commit(db, [
    preparePermissionsAuthorizationGuard(db, actor, [{ permission: "events:manage" }]),
    prepareRevisionGuard(db, CLASSIFIER_SHARED_SCOPE, input.expectedRevision),
    // Whether a check runs and which model it uses are each kind's own; the all-content row holds neither.
    ...prepareSettingsWrite(db, actor, CLASSIFIER_SHARED_SCOPE, {
      enabled: true,
      model: DEFAULT_CLASSIFIER_MODEL,
      context: input.context,
      questions: input.questions,
      disabledQuestionIds: [],
    }),
  ]);
  return { revision: input.expectedRevision + 1 };
}

/** Saves the PKIC-wide settings for one kind. Staff with global event management change them. */
export async function saveClassifierSettings(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  kind: ClassifierKind,
  input: ClassifierSettingsInput,
): Promise<{ revision: number }> {
  // Ids that name no all-content question would silently turn off one added later.
  const shared = (await readScopeQuestions(db, [CLASSIFIER_SHARED_SCOPE])).get(CLASSIFIER_SHARED_SCOPE);
  const sharedIds = new Set(shared?.questions.map((question) => question.id));
  const disabledQuestionIds = [...new Set(input.disabledQuestionIds)].filter((id) => sharedIds.has(id));
  await commit(db, [
    preparePermissionsAuthorizationGuard(db, actor, [{ permission: "events:manage" }]),
    prepareRevisionGuard(db, CLASSIFIER_SHARED_SCOPE, shared?.revision ?? 0),
    prepareRevisionGuard(db, kind, input.expectedRevision),
    ...prepareSettingsWrite(db, actor, kind, { ...input, disabledQuestionIds }),
  ]);
  return { revision: input.expectedRevision + 1 };
}

/** Saves what one event adds to a check. Event managers change them. */
export async function saveEventClassifierAdditions(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventId: string,
  kind: ClassifierKind,
  input: ClassifierEventAdditionsInput,
): Promise<{ revision: number }> {
  const now = nowIso();
  // Ids that name no PKIC-wide question, all content's or the kind's, would silently disable one added later.
  const scopes = await readScopeQuestions(db, [CLASSIFIER_SHARED_SCOPE, kind]);
  const shared = scopes.get(CLASSIFIER_SHARED_SCOPE);
  const own = scopes.get(kind);
  const wideQuestions = mergedClassifierQuestions(
    shared?.questions ?? [],
    own ? { context: "", questions: own.questions, disabledQuestionIds: own.disabledQuestionIds } : null,
  );
  const wideIds = new Set(wideQuestions.map((q) => q.id));
  const disabledQuestionIds = [...new Set(input.disabledQuestionIds)].filter((id) => wideIds.has(id));
  await commit(db, [
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "events:write", context: { type: "event", id: eventId } },
    ]),
    // Turned-off ids were matched to these PKIC-wide questions; a change to them meanwhile refuses the save.
    prepareRevisionGuard(db, CLASSIFIER_SHARED_SCOPE, shared?.revision ?? 0),
    prepareRevisionGuard(db, kind, own?.revision ?? 0),
    prepareStateGuard(db, {
      sql: `SELECT 1 WHERE COALESCE((SELECT revision FROM event_classifier_additions WHERE event_id = ? AND kind = ?), 0) = ?`,
      bindings: [eventId, kind, input.expectedRevision],
    }),
    db
      .prepare(
        `INSERT INTO event_classifier_additions
           (event_id, kind, context, questions_json, disabled_question_ids_json, revision, updated_by_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(event_id, kind) DO UPDATE SET context = excluded.context, questions_json = excluded.questions_json,
           disabled_question_ids_json = excluded.disabled_question_ids_json,
           revision = event_classifier_additions.revision + 1,
           updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
      )
      .bind(
        eventId,
        kind,
        input.context,
        JSON.stringify(input.questions),
        JSON.stringify(disabledQuestionIds),
        actor.id,
        now,
      ),
    prepareAuditLog(db, "user", actor.id, "event_classifier_changed", "event", eventId, {
      kind,
      questions: input.questions.map((question) => question.id),
      disabledQuestionIds,
    }),
  ]);
  return { revision: input.expectedRevision + 1 };
}
