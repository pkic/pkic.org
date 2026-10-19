import { preparePublicationDocumentEffectsGuard } from "./site-publication-document-effects";
import { first } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike } from "../types";
import {
  sitePublicationAttemptSchema,
  sitePublicationCoordinatorConfigSchema,
  type SitePublicationAttempt,
  type SitePublicationCoordinatorConfig,
} from "../../../assets/shared/schemas/site-publication-coordinator";
import {
  PublicationProviderError,
  startSitePublicationBuild,
  attestSitePublicationBuild,
} from "./site-publication-provider";
import type { SitePublicationCiIdentity } from "../../../assets/shared/schemas/site-publication-provider";

const columns = `environment,public_origin AS publicOrigin,id,request_id AS requestId,source_sequence AS sourceSequence,lease_token AS leaseToken,provider_json AS providerJson,phase,build_id AS buildId,version_id AS versionId,snapshot_id AS snapshotId,error_code AS errorCode,created_at AS createdAt,updated_at AS updatedAt`;
export async function readPublicationAttempt(db: DatabaseLike, id: string) {
  const row = await first<SitePublicationAttempt & { providerJson: string }>(
    db,
    `SELECT ${columns} FROM site_publication_provider_attempts WHERE id=?`,
    [id],
  );
  return row ? sitePublicationAttemptSchema.parse({ ...row, provider: JSON.parse(row.providerJson) }) : null;
}
export function preparePublicationAttemptGuard(db: DatabaseLike, attempt: SitePublicationAttempt, phase: string) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM site_publication_pipeline_fence f JOIN site_publication_provider_attempts a ON a.id=f.attempt_id WHERE f.id=1 AND a.id=? AND f.lease_token=? AND a.phase=?`,
    bindings: [attempt.id, attempt.leaseToken, phase],
  });
}
/** Atomically claim the newest desired request before any external write. No actor is synthesized. */
export async function claimPublicationDispatch(
  db: DatabaseLike,
  config: SitePublicationCoordinatorConfig,
  now = new Date(),
) {
  const checked = sitePublicationCoordinatorConfigSchema.parse(config);
  if (!checked.enabled || !checked.exclusiveActivationOwner) return null;
  const value = await first<{ id: string; sequence: number }>(
    db,
    `SELECT r.id,r.sequence FROM site_publication_requests r JOIN site_publication_delivery_state s ON s.id=1 AND s.desired_sequence=r.sequence WHERE r.status IN('queued','failed') AND r.attempts<10 AND (r.next_attempt_at IS NULL OR r.next_attempt_at<=?) AND (r.reason_code IN('rights_withdrawn','version_deleted','version_review_changed') OR r.created_at<=?) AND NOT EXISTS(SELECT 1 FROM site_publication_pipeline_fence WHERE id=1 AND attempt_id IS NOT NULL)`,
    [now.toISOString(), new Date(now.getTime() - checked.debounceSeconds * 1000).toISOString()],
  );
  if (!value) return null;
  const attempt = sitePublicationAttemptSchema.parse({
    environment: checked.environment,
    publicOrigin: checked.publicOrigin,
    id: crypto.randomUUID(),
    requestId: value.id,
    sourceSequence: value.sequence,
    leaseToken: crypto.randomUUID(),
    phase: "dispatching",
    provider: checked.provider,
    buildId: null,
    versionId: null,
    snapshotId: null,
    errorCode: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  await db.batch([
    preparePublicationDocumentEffectsGuard(db, value.sequence),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM site_publication_requests r JOIN site_publication_delivery_state s ON s.id=1 AND s.desired_sequence=r.sequence WHERE r.id=? AND r.status IN('queued','failed') AND r.attempts<10 AND NOT EXISTS(SELECT 1 FROM site_publication_pipeline_fence WHERE id=1 AND attempt_id IS NOT NULL)`,
      bindings: [value.id],
    }),
    db
      .prepare(
        `INSERT INTO site_publication_provider_attempts(id,request_id,source_sequence,lease_token,provider_json,environment,public_origin,phase,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'dispatching',?,?)`,
      )
      .bind(
        attempt.id,
        attempt.requestId,
        attempt.sourceSequence,
        attempt.leaseToken,
        JSON.stringify(attempt.provider),
        attempt.environment,
        attempt.publicOrigin,
        attempt.createdAt,
        attempt.updatedAt,
      ),
    db
      .prepare(
        `INSERT INTO site_publication_pipeline_fence(id,attempt_id,lease_token,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET attempt_id=excluded.attempt_id,lease_token=excluded.lease_token,updated_at=excluded.updated_at`,
      )
      .bind(attempt.id, attempt.leaseToken, attempt.updatedAt),
    db
      .prepare(
        `UPDATE site_publication_requests SET status='rendering',attempts=attempts+1,lease_token=?,lease_owner=?,updated_at=? WHERE id=?`,
      )
      .bind(attempt.leaseToken, attempt.id, attempt.updatedAt, attempt.requestId),
  ]);
  return attempt;
}
/** One POST per durable intent. A lost receipt holds the fence, including after restart. */
export async function dispatchPublicationAttempt(
  db: DatabaseLike,
  candidate: SitePublicationAttempt,
  token: string,
  fetcher: Parameters<typeof startSitePublicationBuild>[2] = fetch,
) {
  // Do not call the provider if this intent was already observed or superseded.
  const current = await readPublicationAttempt(db, candidate.id);
  if (!current || current.phase !== "dispatching" || current.leaseToken !== candidate.leaseToken) return;
  const attempt = current;
  // Move to uncertain BEFORE POST: concurrent/restarted dispatchers cannot repeat a possibly accepted write.
  const now = new Date().toISOString();
  await db.batch([
    preparePublicationAttemptGuard(db, attempt, "dispatching"),
    db
      .prepare(`UPDATE site_publication_provider_attempts SET phase='uncertain',updated_at=? WHERE id=?`)
      .bind(now, attempt.id),
  ]);
  let receipt: { buildId: string };
  try {
    receipt = await startSitePublicationBuild(attempt.provider, token, fetcher);
  } catch (error) {
    const code = error instanceof PublicationProviderError ? error.code : "PROVIDER_WRITE_UNCERTAIN";
    // Only a provider's authoritative rejection proves no accepted write. Everything else remains fenced.
    const rejected = code === "PROVIDER_REJECTED";
    await db.batch([
      preparePublicationAttemptGuard(db, attempt, "uncertain"),
      db
        .prepare(`UPDATE site_publication_provider_attempts SET phase=?,error_code=?,updated_at=? WHERE id=?`)
        .bind(rejected ? "failed" : "uncertain", code, new Date().toISOString(), attempt.id),
      db
        .prepare(`UPDATE site_publication_requests SET last_error_code=?,last_error_at=?,updated_at=? WHERE id=?`)
        .bind(code, new Date().toISOString(), new Date().toISOString(), attempt.requestId),
      ...(rejected
        ? [
            db
              .prepare(
                `UPDATE site_publication_pipeline_fence SET attempt_id=NULL,lease_token=NULL,updated_at=? WHERE id=1`,
              )
              .bind(new Date().toISOString()),
            db
              .prepare(
                `UPDATE site_publication_requests SET status='failed',last_error_code=?,next_attempt_at=?,updated_at=? WHERE id=?`,
              )
              .bind(code, new Date(Date.now() + 60000).toISOString(), new Date().toISOString(), attempt.requestId),
          ]
        : []),
    ]);
    throw new PublicationProviderError(code);
  }
  // A persistence failure after provider acceptance leaves uncertainty fenced; it is never an authoritative rejection.
  await db.batch([
    preparePublicationAttemptGuard(db, attempt, "uncertain"),
    db
      .prepare(
        `UPDATE site_publication_provider_attempts SET phase='building',build_id=?,error_code=NULL,updated_at=? WHERE id=?`,
      )
      .bind(receipt.buildId, new Date().toISOString(), attempt.id),
    db
      .prepare(
        `UPDATE site_publication_requests SET build_id=?,last_error_code=NULL,last_error_at=NULL,updated_at=? WHERE id=?`,
      )
      .bind(receipt.buildId, new Date().toISOString(), attempt.requestId),
  ]);
  return receipt;
}
/** Internal machine transport must authenticate separately; a member-supplied build UUID is never sufficient. */
export async function attestPublicationMachineBuild(
  db: DatabaseLike,
  attemptId: string,
  identity: SitePublicationCiIdentity,
  token: string,
  fetcher: Parameters<typeof attestSitePublicationBuild>[4] = fetch,
) {
  const attempt = await readPublicationAttempt(db, attemptId);
  if (!attempt || attempt.phase !== "building" || attempt.buildId !== identity.WORKERS_CI_BUILD_UUID)
    throw new Error("PUBLICATION_BUILD_AUTHORITY_CHANGED");
  await attestSitePublicationBuild(attempt.provider, token, identity, "building", fetcher);
  await db.batch([
    preparePublicationAttemptGuard(db, attempt, "building"),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM site_publication_delivery_state WHERE id=1 AND desired_sequence=?`,
      bindings: [attempt.sourceSequence],
    }),
    db
      .prepare(`UPDATE site_publication_provider_attempts SET phase='build_attested',updated_at=? WHERE id=?`)
      .bind(new Date().toISOString(), attempt.id),
  ]);
  return { attemptId: attempt.id, sourceSequence: attempt.sourceSequence, buildId: attempt.buildId };
}
