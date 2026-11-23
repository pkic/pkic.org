/**
 * The latest verdict for a checked item: a proposal, an upload of slides, or
 * an audience question. A new check of the same item replaces it. It keeps
 * every answer the model gave, raised or not, so the check can be tuned; the
 * checked text itself is never stored here.
 */
import type { ClassifierKind } from "../../../../assets/shared/classifiers";
import {
  classifierModelSchema,
  classifierVerdictSchema,
  type ClassifierResult,
} from "../../../../assets/shared/schemas/classifiers";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import type { ClassifierRun } from "./model";

export function prepareStoreClassifierResult(
  db: DatabaseLike,
  kind: ClassifierKind,
  subjectId: string,
  run: ClassifierRun,
  checkedAt = nowIso(),
): StatementLike {
  const { verdict } = run;
  return db
    .prepare(
      `INSERT INTO classifier_results (kind, subject_id, outcome, verdict_json, score_percent, model, latency_ms, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, subject_id) DO UPDATE SET outcome = excluded.outcome, verdict_json = excluded.verdict_json,
         score_percent = excluded.score_percent, model = excluded.model, latency_ms = excluded.latency_ms,
         checked_at = excluded.checked_at`,
    )
    .bind(
      kind,
      subjectId,
      verdict.outcome,
      JSON.stringify({ flags: verdict.flags, scores: verdict.scores, answers: run.answers }),
      verdict.scorePercent,
      run.model,
      Math.round(run.latencyMs),
      checkedAt,
    );
}

/** Drops a verdict that no longer describes its subject, once the subject changed and nothing checked the new words. */
export function prepareDeleteClassifierResult(
  db: DatabaseLike,
  kind: ClassifierKind,
  subjectId: string,
): StatementLike {
  return db.prepare("DELETE FROM classifier_results WHERE kind = ? AND subject_id = ?").bind(kind, subjectId);
}

export interface ClassifierResultRow {
  subject_id: string;
  outcome: string;
  verdict_json: string;
  score_percent: number | null;
  model: string | null;
  latency_ms: number;
  checked_at: string;
}

export const CLASSIFIER_RESULT_COLUMNS =
  "subject_id, outcome, verdict_json, score_percent, model, latency_ms, checked_at";

export function prepareClassifierResultsRead(
  db: DatabaseLike,
  kind: ClassifierKind,
  subjectIds: readonly string[],
): StatementLike {
  return db
    .prepare(
      `SELECT ${CLASSIFIER_RESULT_COLUMNS} FROM classifier_results
       WHERE kind = ? AND subject_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(kind, JSON.stringify(subjectIds));
}

/** A stored verdict as reviewers see it; one that no longer parses reads as unchecked. */
export function decodeClassifierResult(row: ClassifierResultRow): ClassifierResult {
  let stored: unknown;
  try {
    stored = JSON.parse(row.verdict_json);
  } catch {
    stored = {};
  }
  const verdict = classifierVerdictSchema.safeParse({
    ...(stored && typeof stored === "object" ? stored : {}),
    outcome: row.outcome,
    scorePercent: row.score_percent,
  });
  const model = classifierModelSchema.safeParse(row.model);
  return {
    ...(verdict.success ? verdict.data : { outcome: "unchecked", flags: [], scores: [], scorePercent: null }),
    model: model.success ? model.data : null,
    latencyMs: row.latency_ms,
    checkedAt: row.checked_at,
  };
}

/** The latest verdict for one item, or null when it was never checked. */
export async function readClassifierResult(
  db: DatabaseLike,
  kind: ClassifierKind,
  subjectId: string,
): Promise<ClassifierResult | null> {
  const row = await prepareClassifierResultsRead(db, kind, [subjectId]).first<ClassifierResultRow>();
  return row ? decodeClassifierResult(row) : null;
}

/** The latest verdicts for a page of items, by item; one that was never checked is absent. */
export async function readClassifierResults(
  db: DatabaseLike,
  kind: ClassifierKind,
  subjects: readonly { id: string }[],
): Promise<Map<string, ClassifierResult>> {
  if (!subjects.length) return new Map();
  const ids = subjects.map((subject) => subject.id);
  const { results } = await prepareClassifierResultsRead(db, kind, ids).all<ClassifierResultRow>();
  return new Map(results.map((row) => [row.subject_id, decodeClassifierResult(row)]));
}
