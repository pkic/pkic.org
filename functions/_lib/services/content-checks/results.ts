/**
 * The latest verdict for a checked proposal or upload of slides. A new check
 * of the same item replaces it; the checked text itself is never stored here.
 */
import type { ContentCheckKind } from "../../../../assets/shared/content-checks";
import {
  contentCheckModelSchema,
  contentCheckVerdictSchema,
  type ContentCheckResult,
} from "../../../../assets/shared/schemas/content-checks";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import type { ContentCheckRun } from "./model";

export function prepareStoreContentCheckResult(
  db: DatabaseLike,
  kind: ContentCheckKind,
  subjectId: string,
  run: ContentCheckRun,
  checkedAt = nowIso(),
): StatementLike {
  const { verdict } = run;
  return db
    .prepare(
      `INSERT INTO content_check_results (kind, subject_id, outcome, verdict_json, score_percent, model, latency_ms, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, subject_id) DO UPDATE SET outcome = excluded.outcome, verdict_json = excluded.verdict_json,
         score_percent = excluded.score_percent, model = excluded.model, latency_ms = excluded.latency_ms,
         checked_at = excluded.checked_at`,
    )
    .bind(
      kind,
      subjectId,
      verdict.outcome,
      JSON.stringify({ flags: verdict.flags, scores: verdict.scores }),
      verdict.scorePercent,
      run.model,
      Math.round(run.latencyMs),
      checkedAt,
    );
}

/** Drops a verdict that no longer describes its subject, once the subject changed and nothing checked the new words. */
export function prepareDeleteContentCheckResult(
  db: DatabaseLike,
  kind: ContentCheckKind,
  subjectId: string,
): StatementLike {
  return db.prepare("DELETE FROM content_check_results WHERE kind = ? AND subject_id = ?").bind(kind, subjectId);
}

export interface ContentCheckResultRow {
  subject_id: string;
  outcome: string;
  verdict_json: string;
  score_percent: number | null;
  model: string | null;
  latency_ms: number;
  checked_at: string;
}

export const CONTENT_CHECK_RESULT_COLUMNS =
  "subject_id, outcome, verdict_json, score_percent, model, latency_ms, checked_at";

export function prepareContentCheckResultsRead(
  db: DatabaseLike,
  kind: ContentCheckKind,
  subjectIds: readonly string[],
): StatementLike {
  return db
    .prepare(
      `SELECT ${CONTENT_CHECK_RESULT_COLUMNS} FROM content_check_results
       WHERE kind = ? AND subject_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(kind, JSON.stringify(subjectIds));
}

/** A stored verdict as reviewers see it; one that no longer parses reads as unchecked. */
export function decodeContentCheckResult(row: ContentCheckResultRow): ContentCheckResult {
  let stored: unknown;
  try {
    stored = JSON.parse(row.verdict_json);
  } catch {
    stored = {};
  }
  const verdict = contentCheckVerdictSchema.safeParse({
    ...(stored && typeof stored === "object" ? stored : {}),
    outcome: row.outcome,
    scorePercent: row.score_percent,
  });
  const model = contentCheckModelSchema.safeParse(row.model);
  return {
    ...(verdict.success ? verdict.data : { outcome: "unchecked", flags: [], scores: [], scorePercent: null }),
    model: model.success ? model.data : null,
    latencyMs: row.latency_ms,
    checkedAt: row.checked_at,
  };
}

/** The latest verdict for one item, or null when it was never checked. */
export async function readContentCheckResult(
  db: DatabaseLike,
  kind: ContentCheckKind,
  subjectId: string,
): Promise<ContentCheckResult | null> {
  const row = await prepareContentCheckResultsRead(db, kind, [subjectId]).first<ContentCheckResultRow>();
  return row ? decodeContentCheckResult(row) : null;
}

/** The latest verdicts for a page of items, by item; one that was never checked is absent. */
export async function readContentCheckResults(
  db: DatabaseLike,
  kind: ContentCheckKind,
  subjects: readonly { id: string }[],
): Promise<Map<string, ContentCheckResult>> {
  if (!subjects.length) return new Map();
  const ids = subjects.map((subject) => subject.id);
  const { results } = await prepareContentCheckResultsRead(db, kind, ids).all<ContentCheckResultRow>();
  return new Map(results.map((row) => [row.subject_id, decodeContentCheckResult(row)]));
}
