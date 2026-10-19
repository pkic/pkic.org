import { all, first } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { publicationDocumentEffectsSchema } from "../../../assets/shared/schemas/site-publication-documents";
import { writePublicationDocumentDenial } from "./site-publication-document-projection";
import type { SitePublicationAttempt } from "../../../assets/shared/schemas/site-publication-coordinator";

/** Every coalesced withdrawal must finish before a provider intent or delivery acknowledgment. */
export function preparePublicationDocumentEffectsGuard(db: DatabaseLike, sourceSequence: number) {
  return prepareAuthorizationGuard(db, {
    sql: "SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM site_publication_requests WHERE sequence<=? AND document_effects_json<>'[]' AND document_effects_completed_at IS NULL)",
    bindings: [sourceSequence],
  });
}

/** R2 denial is verified first; a crash leaves this immutable request available to the same retry owner. */
export async function completePublicationDocumentEffectsForRequest(
  db: DatabaseLike,
  bucket: R2Bucket | undefined,
  deduplicationKey: string,
): Promise<boolean> {
  const row = await first<{ id: string; document_effects_json: string; document_effects_completed_at: string | null }>(
    db,
    "SELECT id,document_effects_json,document_effects_completed_at FROM site_publication_requests WHERE deduplication_key=?",
    [deduplicationKey],
  );
  if (!row) throw new Error("PUBLICATION_DOCUMENT_EFFECT_REQUEST_MISSING");
  const effects = publicationDocumentEffectsSchema.parse(JSON.parse(row.document_effects_json));
  if (!effects.length || row.document_effects_completed_at) return true;
  const recordFailure = async (code: string) => {
    const now = nowIso();
    const result = await db
      .prepare(
        "UPDATE site_publication_requests SET last_error_code=?,last_error_at=?,updated_at=? WHERE id=? AND document_effects_json=? AND document_effects_completed_at IS NULL",
      )
      .bind(code, now, now, row.id, row.document_effects_json)
      .run();
    if (result.meta?.changes !== 1) throw new Error("PUBLICATION_DOCUMENT_EFFECT_REQUEST_CHANGED");
    return false;
  };
  if (!bucket) return recordFailure("PUBLICATION_DOCUMENT_BUCKET_UNAVAILABLE");
  try {
    for (const effect of effects) await writePublicationDocumentDenial(bucket, effect);
  } catch {
    return recordFailure("PUBLICATION_DOCUMENT_WITHDRAWAL_PENDING");
  }
  await db.batch([
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM site_publication_requests WHERE id=? AND document_effects_json=?",
      bindings: [row.id, row.document_effects_json],
    }),
    db
      .prepare(
        "UPDATE site_publication_requests SET document_effects_completed_at=COALESCE(document_effects_completed_at,?),updated_at=?,last_error_at=CASE WHEN last_error_code IN('PUBLICATION_DOCUMENT_BUCKET_UNAVAILABLE','PUBLICATION_DOCUMENT_WITHDRAWAL_PENDING') THEN NULL ELSE last_error_at END,last_error_code=CASE WHEN last_error_code IN('PUBLICATION_DOCUMENT_BUCKET_UNAVAILABLE','PUBLICATION_DOCUMENT_WITHDRAWAL_PENDING') THEN NULL ELSE last_error_code END WHERE id=? AND document_effects_json=?",
      )
      .bind(nowIso(), nowIso(), row.id, row.document_effects_json),
  ]);
  return true;
}

/** One schema-bounded request per tick, including obsolete requests coalesced by a newer release. */
export async function processPendingPublicationDocumentEffects(db: DatabaseLike, bucket?: R2Bucket): Promise<boolean> {
  const rows = await all<{ deduplication_key: string }>(
    db,
    "SELECT deduplication_key FROM site_publication_requests WHERE document_effects_json<>'[]' AND document_effects_completed_at IS NULL ORDER BY sequence LIMIT 2",
  );
  if (!rows.length) return true;
  if (!(await completePublicationDocumentEffectsForRequest(db, bucket, rows[0]!.deduplication_key))) return false;
  return rows.length === 1;
}

/** Retain externally verified deployment truth even while delivery is blocked by a withdrawal. */
export async function recordVerifiedPublicationActivationReceipt(
  db: DatabaseLike,
  attempt: SitePublicationAttempt,
  deployment: { id: string; activatedAt: string },
) {
  await db.batch([
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM site_publication_pipeline_fence fence JOIN site_publication_provider_attempts attempt ON attempt.id=fence.attempt_id WHERE fence.id=1 AND attempt.id=? AND fence.lease_token=? AND attempt.phase='activating'",
      bindings: [attempt.id, attempt.leaseToken],
    }),
    db
      .prepare(
        "INSERT INTO site_publication_activation_receipts(id,request_id,source_sequence,snapshot_id,build_id,release_id,activated_at,recorded_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      )
      .bind(
        deployment.id,
        attempt.requestId,
        attempt.sourceSequence,
        attempt.snapshotId,
        attempt.buildId,
        attempt.versionId,
        deployment.activatedAt,
        nowIso(),
      ),
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM site_publication_activation_receipts WHERE id=? AND request_id=? AND source_sequence=? AND snapshot_id=? AND build_id=? AND release_id=? AND activated_at=?",
      bindings: [
        deployment.id,
        attempt.requestId,
        attempt.sourceSequence,
        attempt.snapshotId,
        attempt.buildId,
        attempt.versionId,
        deployment.activatedAt,
      ],
    }),
  ]);
}
