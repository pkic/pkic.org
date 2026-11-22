/**
 * The automatic check of uploaded slides. It runs right after an upload and
 * never holds the upload up; a scheduled pass is the one retry owner and
 * picks up every recent version still without a verdict, such as one whose
 * check failed or whose Worker stopped before it finished.
 */
import type { DatabaseLike, Env } from "../../types";
import { all, first } from "../../db/queries";
import { logError } from "../../logging";
import { nowIso } from "../../utils/time";
import { runContentCheck, type ContentCheckRun } from "./model";
import { PRESENTATION_CHECK_MAX_BYTES, extractPresentationText, presentationTextReadable } from "./presentation-text";
import { prepareStoreContentCheckResult } from "./results";
import { readEffectiveContentCheck } from "./settings";
import { contentCheckState } from "./state";
import { UNCHECKED_CONTENT_VERDICT } from "../../../../assets/shared/content-checks";

/** Slides wait off the author's request, so the check may take its time. */
const PRESENTATION_CHECK_TIMEOUT_MS = 30_000;
/** A version still without a verdict after this long is left unchecked. */
const PRESENTATION_CHECK_RETRY_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

type PresentationCheckEnv = Pick<Env, "AI" | "SPEAKER_UPLOADS_BUCKET"> & { DB: DatabaseLike };

export type PresentationCheckOutcome = "checked" | "unchecked" | "retry" | "gone";

interface PendingVersion {
  id: string;
  r2_key: string;
  file_name: string | null;
  file_size: number | null;
  title: string;
  event_id: string;
}

const UNREADABLE: ContentCheckRun = { verdict: UNCHECKED_CONTENT_VERDICT, answers: {}, model: null, latencyMs: 0 };

/** Checks one uploaded version that has no verdict yet. */
export async function checkPresentationVersion(
  env: PresentationCheckEnv,
  versionId: string,
): Promise<PresentationCheckOutcome> {
  const version = await first<PendingVersion>(
    env.DB,
    `SELECT pv.id, pv.r2_key, pv.file_name, pv.file_size, sp.title, sp.event_id
     FROM presentation_versions pv JOIN session_proposals sp ON sp.id = pv.proposal_id
     WHERE pv.id = ? AND pv.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM content_check_results r WHERE r.kind = 'presentation' AND r.subject_id = pv.id)`,
    [versionId],
  );
  if (!version) return "gone";
  const store = async (run: ContentCheckRun) => {
    await prepareStoreContentCheckResult(env.DB, "presentation", version.id, run, nowIso()).run();
  };
  const check = await readEffectiveContentCheck(env.DB, version.event_id, "presentation");
  if (!env.AI || !check.enabled || !check.questions.length) {
    await store(UNREADABLE);
    return "unchecked";
  }
  if (!presentationTextReadable(version.file_name) || (version.file_size ?? 0) > PRESENTATION_CHECK_MAX_BYTES) {
    await store(UNREADABLE);
    return "unchecked";
  }
  const object = await env.SPEAKER_UPLOADS_BUCKET?.get(version.r2_key);
  if (!object) return "retry";
  if (object.size > PRESENTATION_CHECK_MAX_BYTES) {
    await store(UNREADABLE);
    return "unchecked";
  }
  let text: string | null;
  try {
    text = await extractPresentationText(env, { bytes: await object.arrayBuffer(), fileName: version.file_name });
  } catch (error) {
    logError("PRESENTATION_TEXT_FAILED", { reason: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
    return "retry";
  }
  if (!text) {
    await store(UNREADABLE);
    return "unchecked";
  }
  const run = await runContentCheck(env, check, contentCheckState("presentation", { title: version.title, text }), {
    timeoutMs: PRESENTATION_CHECK_TIMEOUT_MS,
  });
  // No answers means the model failed: the scheduled pass tries again.
  if (!Object.keys(run.answers).length) return "retry";
  await store(run);
  return "checked";
}

/** The scheduled pass: recent versions still without a verdict, a few at a time. */
export async function checkPendingPresentations(env: PresentationCheckEnv, limit = 5, now = Date.now()) {
  const pending = await all<{ id: string }>(
    env.DB,
    `SELECT pv.id FROM presentation_versions pv
     WHERE pv.deleted_at IS NULL AND pv.uploaded_at > ?
       AND NOT EXISTS (SELECT 1 FROM content_check_results r WHERE r.kind = 'presentation' AND r.subject_id = pv.id)
     ORDER BY pv.uploaded_at LIMIT ?`,
    [new Date(now - PRESENTATION_CHECK_RETRY_WINDOW_MS).toISOString(), limit],
  );
  const summary: Record<PresentationCheckOutcome, number> = { checked: 0, unchecked: 0, retry: 0, gone: 0 };
  for (const { id } of pending) summary[await checkPresentationVersion(env, id)] += 1;
  return summary;
}

/** The check right after an upload; a failure is the scheduled pass's to retry. */
export async function checkUploadedPresentation(env: PresentationCheckEnv, versionId: string): Promise<void> {
  try {
    await checkPresentationVersion(env, versionId);
  } catch (error) {
    logError("PRESENTATION_CHECK_FAILED", { reason: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
  }
}
