/**
 * The settings of automatic checks: PKIC-wide per kind of content, and what
 * one event adds. No question ships with the code: until staff save PKIC-wide
 * settings a kind is off, asks nothing and costs no model call.
 */
import {
  CLASSIFIER_KINDS,
  CLASSIFIER_MAX_QUESTIONS,
  classifierQuestionLimitRefusal,
  defaultClassifierModel,
  effectiveClassifier,
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
  type ClassifierSettingsResponse,
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

/** The PKIC-wide settings, what the event adds and the event itself, for one kind or all kinds: one batch, three statements. */
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
        `SELECT kind, enabled, model, context, questions_json, revision, updated_at
         FROM classifier_settings WHERE kind IN (${list})`,
      )
      .bind(...kinds),
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
function unsavedSettings(kind: ClassifierKind): ClassifierSettings {
  return { enabled: false, model: defaultClassifierModel(kind), context: "", questions: [] };
}

function settingsResponse(kind: ClassifierKind, row: SettingsRow | undefined): ClassifierSettingsResponse {
  if (!row) return { kind, revision: 0, saved: false, updatedAt: null, ...unsavedSettings(kind) };
  const model = classifierModelSchema.safeParse(row.model);
  return {
    kind,
    revision: row.revision,
    saved: true,
    updatedAt: row.updated_at,
    enabled: row.enabled === 1,
    model: model.success ? model.data : defaultClassifierModel(kind),
    context: row.context,
    questions: decodeQuestions(row.questions_json),
  };
}

export interface DecodedClassifierSettings {
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
  return { settings, additions, eventDescription: describeEvent(eventRow) };
}

function asSettings(response: ClassifierSettingsResponse): ClassifierSettings {
  return { enabled: response.enabled, model: response.model, context: response.context, questions: response.questions };
}

export function effectiveCheckFrom(decoded: DecodedClassifierSettings, kind: ClassifierKind): EffectiveClassifier {
  return effectiveClassifier(
    asSettings(decoded.settings.get(kind)!),
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

export async function listClassifierSettings(db: DatabaseLike): Promise<ClassifierSettingsResponse[]> {
  const results = await db.batch(prepareClassifierSettingsRead(db, null, null));
  const decoded = decodeClassifierSettings(results);
  return CLASSIFIER_KINDS.map((kind) => decoded.settings.get(kind)!);
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
    settings: decoded.settings.get(kind)!,
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

function questionLimitError(field: string, message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", message, { formErrors: [], fieldErrors: { [field]: [message] } });
}

/**
 * A PKIC-wide change must not leave an event asking more questions than a check runs: refused, not dropped. Returns
 * a guard that refuses the save when any event's additions changed after this read; revisions only grow, so the
 * count and sum of them change with every insert or update.
 */
async function refuseQuestionsEventsCannotCarry(
  db: DatabaseLike,
  kind: ClassifierKind,
  questions: readonly ClassifierQuestion[],
): Promise<StatementLike> {
  // One set-based read, bounded to a single row: how many events would ask more than a check runs, and the count and
  // revision sum the guard below compares, all from the same snapshot. The merge counted here is
  // `mergedClassifierQuestions`: the PKIC-wide and event question ids together, less the ones the event turns off.
  const snapshot = await db
    .prepare(
      `SELECT COUNT(*) AS rows_read, COALESCE(SUM(revision), 0) AS revisions,
         COALESCE(SUM((
           SELECT COUNT(*) FROM (
             SELECT value AS id FROM json_each(?2)
             UNION SELECT json_extract(added.value, '$.id') FROM json_each(additions.questions_json) AS added
           ) AS merged
           WHERE merged.id NOT IN (SELECT value FROM json_each(additions.disabled_question_ids_json))
         ) > ?3), 0) AS over
       FROM event_classifier_additions AS additions WHERE kind = ?1`,
    )
    .bind(kind, JSON.stringify(questions.map((question) => question.id)), CLASSIFIER_MAX_QUESTIONS)
    .first<{ rows_read: number; revisions: number; over: number }>();
  const over = snapshot?.over ?? 0;
  if (over)
    throw questionLimitError(
      "questions",
      `${over} ${over === 1 ? "event adds" : "events add"} questions that would no longer fit beside these. Remove some here or in ${over === 1 ? "that event" : "those events"}.`,
    );
  return prepareStateGuard(db, {
    sql: `SELECT 1 FROM (SELECT COUNT(*) AS rows_read, COALESCE(SUM(revision), 0) AS revisions
          FROM event_classifier_additions WHERE kind = ?) WHERE rows_read = ? AND revisions = ?`,
    bindings: [kind, snapshot?.rows_read ?? 0, snapshot?.revisions ?? 0],
  });
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
export async function saveClassifierSettings(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  kind: ClassifierKind,
  input: ClassifierSettingsInput,
): Promise<{ revision: number }> {
  const now = nowIso();
  const additionsUnchanged = await refuseQuestionsEventsCannotCarry(db, kind, input.questions);
  await commit(db, [
    preparePermissionsAuthorizationGuard(db, actor, [{ permission: "events:manage" }]),
    additionsUnchanged,
    prepareStateGuard(db, {
      sql: "SELECT 1 WHERE COALESCE((SELECT revision FROM classifier_settings WHERE kind = ?), 0) = ?",
      bindings: [kind, input.expectedRevision],
    }),
    db
      .prepare(
        `INSERT INTO classifier_settings (kind, enabled, model, context, questions_json, revision, updated_by_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET enabled = excluded.enabled, model = excluded.model, context = excluded.context,
           questions_json = excluded.questions_json, revision = classifier_settings.revision + 1,
           updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
      )
      .bind(kind, input.enabled ? 1 : 0, input.model, input.context, JSON.stringify(input.questions), actor.id, now),
    prepareAuditLog(db, "user", actor.id, "classifier_settings_changed", "classifier", kind, {
      enabled: input.enabled,
      model: input.model,
      questions: input.questions.map((question) => question.id),
    }),
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
  // Ids that name no PKIC-wide question would silently disable one added later.
  const wide = await db
    .prepare("SELECT questions_json, revision FROM classifier_settings WHERE kind = ?")
    .bind(kind)
    .first<{ questions_json: string; revision: number }>();
  const wideQuestions = wide ? decodeQuestions(wide.questions_json) : [];
  const wideIds = new Set(wideQuestions.map((q) => q.id));
  const disabledQuestionIds = [...new Set(input.disabledQuestionIds)].filter((id) => wideIds.has(id));
  const tooMany = classifierQuestionLimitRefusal(wideQuestions, { ...input, disabledQuestionIds });
  if (tooMany) throw questionLimitError("questions", tooMany);
  await commit(db, [
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "events:write", context: { type: "event", id: eventId } },
    ]),
    // The limit was checked against these PKIC-wide questions; a change to them meanwhile refuses the save.
    prepareStateGuard(db, {
      sql: "SELECT 1 WHERE COALESCE((SELECT revision FROM classifier_settings WHERE kind = ?), 0) = ?",
      bindings: [kind, wide?.revision ?? 0],
    }),
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
