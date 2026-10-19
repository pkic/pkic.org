import {
  preparePublicationDocumentEffectsGuard,
  recordVerifiedPublicationActivationReceipt,
} from "./site-publication-document-effects";
import { first } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { sha256Hex } from "../utils/crypto";
import type { DatabaseLike } from "../types";
import {
  sitePublicationPublicOriginSchema,
  sitePublicationMachineContextSchema,
  sitePublicationMachineCompletionSchema,
  sitePublicationCoordinatorConfigSchema,
  type SitePublicationMachineContext,
  type SitePublicationCoordinatorConfig,
} from "../../../assets/shared/schemas/site-publication-coordinator";
import {
  sitePublicationReleaseSchema,
  publicationIntegrityHashInput,
  type SitePublicationRelease,
} from "../../../assets/shared/schemas/site-publication-release";
import { readPublicationAttempt, preparePublicationAttemptGuard } from "./site-publication-coordinator";
import { prepareSiteAgendaActivationGuards } from "./site-publication-agenda-activation";
import {
  inspectSitePublicationBuild,
  activateSitePublicationVersion,
  attestSitePublicationVersion,
  readSitePublicationDeployments,
  PublicationProviderError,
} from "./site-publication-provider";
const maximumReleaseBytes = 4 * 1024 * 1024;
function sourceGuard(db: DatabaseLike, sequence: number) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM site_publication_delivery_state WHERE id=1 AND desired_sequence=? AND delivered_sequence<?`,
    bindings: [sequence, sequence],
  });
}
function evidence(db: DatabaseLike, context: SitePublicationMachineContext, action: string, value: unknown) {
  return db
    .prepare(
      `INSERT INTO site_publication_machine_evidence(id,attempt_id,identity_type,machine_build_id,action,evidence_json,created_at) VALUES(?,?,?,?,?,?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      context.attemptId,
      context.identityType,
      context.buildId,
      action,
      JSON.stringify(value),
      new Date().toISOString(),
    );
}
/** Native D1 machine transport verifies local complete-Worker/assets bytes before calling; no public/user endpoint. */
export async function completePublicationMachineBuild(
  db: DatabaseLike,
  context: SitePublicationMachineContext,
  input: unknown,
) {
  const machine = sitePublicationMachineContextSchema.parse(context);
  const value = sitePublicationMachineCompletionSchema.parse(input);
  const attempt = await readPublicationAttempt(db, machine.attemptId);
  if (
    attempt &&
    attempt.buildId === machine.buildId &&
    ["awaiting_activation", "activating", "delivered"].includes(attempt.phase)
  ) {
    const existing = await first<{ version_id: string; worker_bundle_sha256: string; release_json: string }>(
      db,
      "SELECT version_id,worker_bundle_sha256,release_json FROM site_publication_attempt_releases WHERE attempt_id=?",
      [attempt.id],
    );
    if (
      existing &&
      existing.version_id === value.versionId &&
      existing.worker_bundle_sha256 === value.workerBundleSha256 &&
      existing.release_json === JSON.stringify(value.release)
    )
      return { attemptId: attempt.id, versionId: value.versionId, sourceSequence: attempt.sourceSequence };
    throw new Error("PUBLICATION_RELEASE_IDENTITY_CHANGED");
  }
  if (
    !attempt ||
    attempt.phase !== "build_attested" ||
    attempt.buildId !== machine.buildId ||
    value.release.sourceSequence !== attempt.sourceSequence ||
    value.release.source !== "native" ||
    value.release.environment !== attempt.environment
  )
    throw new Error("PUBLICATION_BUILD_AUTHORITY_CHANGED");
  const integrity = value.release.integrity!;
  if ((await sha256Hex(publicationIntegrityHashInput(integrity.files))) !== integrity.digest)
    throw new Error("PUBLICATION_INTEGRITY_INVALID");
  const json = JSON.stringify(value.release);
  if (new TextEncoder().encode(json).byteLength > maximumReleaseBytes) throw new Error("PUBLICATION_RELEASE_TOO_LARGE");
  const now = new Date().toISOString();
  await db.batch([
    preparePublicationAttemptGuard(db, attempt, "build_attested"),
    sourceGuard(db, attempt.sourceSequence),
    db
      .prepare(
        `INSERT INTO site_publication_attempt_releases(attempt_id,version_id,source_sequence,snapshot_id,integrity_digest,worker_bundle_sha256,release_json,created_at) VALUES(?,?,?,?,?,?,?,?)`,
      )
      .bind(
        attempt.id,
        value.versionId,
        attempt.sourceSequence,
        value.release.snapshotId,
        integrity.digest,
        value.workerBundleSha256,
        json,
        now,
      ),
    db
      .prepare(
        `UPDATE site_publication_provider_attempts SET phase='awaiting_activation',version_id=?,snapshot_id=?,updated_at=? WHERE id=?`,
      )
      .bind(value.versionId, value.release.snapshotId, now, attempt.id),
    db
      .prepare(
        `UPDATE site_publication_requests SET status='awaiting_activation',source_sequence=?,snapshot_id=?,release_id=?,updated_at=? WHERE id=?`,
      )
      .bind(attempt.sourceSequence, value.release.snapshotId, value.versionId, now, attempt.requestId),
    evidence(db, machine, "release_uploaded", {
      versionId: value.versionId,
      sourceSequence: attempt.sourceSequence,
      snapshotId: value.release.snapshotId,
      integrityDigest: integrity.digest,
      workerBundleSha256: value.workerBundleSha256,
    }),
  ]);
  return { attemptId: attempt.id, versionId: value.versionId, sourceSequence: attempt.sourceSequence };
}
/** Validate the durable target and freshly attest a version before activating or superseding it. */
async function prepareAttestedAwaitingActivation(
  db: DatabaseLike,
  config: SitePublicationCoordinatorConfig,
  attemptId: string,
  token: string,
  fetcher: Parameters<typeof activateSitePublicationVersion>[3] = fetch,
) {
  const checked = sitePublicationCoordinatorConfigSchema.parse(config);
  if (!checked.enabled || !checked.exclusiveActivationOwner) return { state: "disabled" as const };
  const attempt = await readPublicationAttempt(db, attemptId);
  if (!attempt || attempt.phase !== "awaiting_activation" || !attempt.versionId || !attempt.buildId)
    return { state: "authority_changed" as const };
  // The durable pin is authoritative; current scheduled configuration must name that exact target too.
  if (
    checked.environment !== attempt.environment ||
    checked.publicOrigin !== attempt.publicOrigin ||
    JSON.stringify(checked.provider) !== JSON.stringify(attempt.provider)
  )
    throw new Error("PUBLICATION_PROVIDER_TARGET_CHANGED");
  await attestSitePublicationVersion(
    attempt.provider,
    token,
    {
      WORKERS_CI_BUILD_UUID: attempt.buildId,
      WORKERS_CI_BRANCH: attempt.provider.branch,
      WORKERS_CI_COMMIT_SHA: attempt.provider.commitHash,
    },
    attempt.versionId,
    fetcher,
  );
  return {
    state: "ready" as const,
    attempt: { ...attempt, buildId: attempt.buildId, versionId: attempt.versionId },
  };
}
/** Persist activation intent before exactly one POST. Unknown acceptance is never retried or expired. */
export async function activatePublicationAttempt(
  db: DatabaseLike,
  config: SitePublicationCoordinatorConfig,
  attemptId: string,
  token: string,
  fetcher: Parameters<typeof activateSitePublicationVersion>[3] = fetch,
) {
  const prepared = await prepareAttestedAwaitingActivation(db, config, attemptId, token, fetcher);
  if (prepared.state !== "ready") return prepared;
  const { attempt } = prepared;
  const agendaGuards = await prepareSiteAgendaActivationGuards(db);
  const now = new Date().toISOString();
  await db.batch([
    preparePublicationAttemptGuard(db, attempt, "awaiting_activation"),
    sourceGuard(db, attempt.sourceSequence),
    ...agendaGuards,
    db
      .prepare(`INSERT INTO site_publication_attempt_activation(attempt_id,created_at) VALUES(?,?)`)
      .bind(attempt.id, now),
    db
      .prepare(`UPDATE site_publication_provider_attempts SET phase='activating',updated_at=? WHERE id=?`)
      .bind(now, attempt.id),
    evidence(
      db,
      { identityType: "native_build_machine", attemptId: attempt.id, buildId: attempt.buildId },
      "activation_intent",
      { versionId: attempt.versionId, sourceSequence: attempt.sourceSequence },
    ),
  ]);
  try {
    const receipt = await activateSitePublicationVersion(attempt.provider, token, attempt.versionId, fetcher);
    await db.batch([
      preparePublicationAttemptGuard(db, attempt, "activating"),
      db
        .prepare(`UPDATE site_publication_attempt_activation SET deployment_id=? WHERE attempt_id=?`)
        .bind(receipt.deploymentId, attempt.id),
    ]);
    return { state: "awaiting_receipt" as const, deploymentId: receipt.deploymentId };
  } catch (error) {
    const code = error instanceof PublicationProviderError ? error.code : "PROVIDER_WRITE_UNCERTAIN";
    // Even an authoritative rejection stays fenced until an independent read establishes the active version.
    await db.batch([
      preparePublicationAttemptGuard(db, attempt, "activating"),
      db
        .prepare(`UPDATE site_publication_provider_attempts SET error_code=?,updated_at=? WHERE id=?`)
        .bind(code, new Date().toISOString(), attempt.id),
      db
        .prepare(`UPDATE site_publication_requests SET last_error_code=?,last_error_at=?,updated_at=? WHERE id=?`)
        .bind(code, new Date().toISOString(), new Date().toISOString(), attempt.requestId),
    ]);
    throw new PublicationProviderError(code);
  }
}
async function readLiveRelease(
  origin: string,
  fetcher: NonNullable<Parameters<typeof activateSitePublicationVersion>[3]>,
) {
  const response = await fetcher(`${sitePublicationPublicOriginSchema.parse(origin)}/publication.json`, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok || !response.body) throw new Error("PUBLICATION_LIVE_RECEIPT_UNAVAILABLE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > maximumReleaseBytes) throw new Error("PUBLICATION_LIVE_RECEIPT_INVALID");
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return sitePublicationReleaseSchema.parse(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
function exactActiveDeployment(
  rows: Awaited<ReturnType<typeof readSitePublicationDeployments>>,
  versionId: string,
  knownId: string | null,
) {
  const sorted = [...rows].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  const first = sorted[0];
  if (
    !first ||
    (sorted[1] && sorted[1].created_on === first.created_on) ||
    (knownId && first.id !== knownId) ||
    first.versions.length !== 1 ||
    first.versions[0]?.version_id !== versionId ||
    first.versions[0]?.percentage !== 100
  )
    throw new Error("PUBLICATION_ACTIVE_VERSION_UNCONFIRMED");
  return first;
}
/** Fresh provider read → cache-bypassed live manifest → second provider read. No POST is repeated. */
export async function confirmPublicationActivation(
  db: DatabaseLike,
  config: SitePublicationCoordinatorConfig,
  attemptId: string,
  token: string,
  fetcher: Parameters<typeof activateSitePublicationVersion>[3] = fetch,
) {
  const checked = sitePublicationCoordinatorConfigSchema.parse(config);
  if (!checked.enabled || !checked.exclusiveActivationOwner) return { state: "disabled" as const };
  const attempt = await readPublicationAttempt(db, attemptId);
  if (!attempt || attempt.phase !== "activating" || !attempt.buildId || !attempt.versionId || !attempt.snapshotId)
    return { state: "authority_changed" as const };
  const stored = await first<{ release_json: string }>(
    db,
    "SELECT release_json FROM site_publication_attempt_releases WHERE attempt_id=?",
    [attempt.id],
  );
  const intent = await first<{ deployment_id: string | null }>(
    db,
    "SELECT deployment_id FROM site_publication_attempt_activation WHERE attempt_id=?",
    [attempt.id],
  );
  if (!stored || !intent) throw new Error("PUBLICATION_ACTIVATION_EVIDENCE_MISSING");
  const expected = sitePublicationReleaseSchema.parse(JSON.parse(stored.release_json) as unknown);
  const active = exactActiveDeployment(
    await readSitePublicationDeployments(attempt.provider, token, fetcher),
    attempt.versionId,
    intent.deployment_id,
  );
  if (
    checked.environment !== attempt.environment ||
    checked.publicOrigin !== attempt.publicOrigin ||
    JSON.stringify(checked.provider) !== JSON.stringify(attempt.provider)
  )
    throw new Error("PUBLICATION_PROVIDER_TARGET_CHANGED");
  const live = await readLiveRelease(attempt.publicOrigin, fetcher);
  assertSameRelease(expected, live);
  const again = exactActiveDeployment(
    await readSitePublicationDeployments(attempt.provider, token, fetcher),
    attempt.versionId,
    active.id,
  );
  const now = new Date().toISOString();
  await recordVerifiedPublicationActivationReceipt(db, attempt, {
    id: again.id,
    activatedAt: again.created_on,
  });
  await db.batch([
    preparePublicationAttemptGuard(db, attempt, "activating"),
    preparePublicationDocumentEffectsGuard(db, attempt.sourceSequence),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM site_publication_delivery_state WHERE id=1 AND desired_sequence>=? AND delivered_sequence<?`,
      bindings: [attempt.sourceSequence, attempt.sourceSequence],
    }),
    db
      .prepare(
        `UPDATE site_publication_delivery_state SET delivered_sequence=?,snapshot_id=?,build_id=?,release_id=?,activation_receipt_id=?,activated_at=?,updated_at=? WHERE id=1`,
      )
      .bind(
        attempt.sourceSequence,
        attempt.snapshotId,
        attempt.buildId,
        attempt.versionId,
        again.id,
        again.created_on,
        now,
      ),
    db
      .prepare(
        `UPDATE site_publication_requests SET status='delivered',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,last_error_at=NULL,updated_at=? WHERE sequence<=?`,
      )
      .bind(now, attempt.sourceSequence),
    db
      .prepare(`UPDATE site_publication_provider_attempts SET phase='delivered',updated_at=? WHERE id=?`)
      .bind(now, attempt.id),
    db
      .prepare(`UPDATE site_publication_attempt_activation SET deployment_id=?,confirmed_at=? WHERE attempt_id=?`)
      .bind(again.id, now, attempt.id),
    db
      .prepare(`UPDATE site_publication_pipeline_fence SET attempt_id=NULL,lease_token=NULL,updated_at=? WHERE id=1`)
      .bind(now),
    evidence(
      db,
      { identityType: "native_build_machine", attemptId: attempt.id, buildId: attempt.buildId },
      "activation_verified",
      {
        deploymentId: again.id,
        versionId: attempt.versionId,
        sourceSequence: attempt.sourceSequence,
        integrityDigest: expected.integrity!.digest,
      },
    ),
  ]);
  return { state: "delivered" as const, sourceSequence: attempt.sourceSequence, deploymentId: again.id };
}
export function assertSameRelease(expected: SitePublicationRelease, live: SitePublicationRelease) {
  if (
    !expected.integrity ||
    !live.integrity ||
    expected.source !== live.source ||
    expected.environment !== live.environment ||
    expected.sourceSequence !== live.sourceSequence ||
    expected.snapshotId !== live.snapshotId ||
    expected.integrity.digest !== live.integrity.digest ||
    publicationIntegrityHashInput(expected.integrity.files) !== publicationIntegrityHashInput(live.integrity.files)
  )
    throw new Error("PUBLICATION_LIVE_RELEASE_MISMATCH");
}

/** A superseded uploaded version can release only before any durable activation intent and with fresh provider evidence. */
export async function supersedePublicationAttempt(
  db: DatabaseLike,
  config: SitePublicationCoordinatorConfig,
  attemptId: string,
  token: string,
  fetcher: Parameters<typeof activateSitePublicationVersion>[3] = fetch,
) {
  const prepared = await prepareAttestedAwaitingActivation(db, config, attemptId, token, fetcher);
  if (prepared.state !== "ready") return prepared;
  const { attempt } = prepared;
  const rows = await readSitePublicationDeployments(attempt.provider, token, fetcher);
  const latest = [...rows].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  if (
    (latest[1] && latest[1].created_on === latest[0]?.created_on) ||
    latest[0]?.versions.some((value) => value.version_id === attempt.versionId && value.percentage > 0)
  )
    throw new Error("PUBLICATION_VERSION_MAY_BE_ACTIVE");
  const now = new Date().toISOString();
  await db.batch([
    preparePublicationAttemptGuard(db, attempt, "awaiting_activation"),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM site_publication_delivery_state WHERE id=1 AND desired_sequence>? AND NOT EXISTS(SELECT 1 FROM site_publication_attempt_activation WHERE attempt_id=?)`,
      bindings: [attempt.sourceSequence, attempt.id],
    }),
    db
      .prepare(`UPDATE site_publication_provider_attempts SET phase='superseded',updated_at=? WHERE id=?`)
      .bind(now, attempt.id),
    db
      .prepare(
        `UPDATE site_publication_requests SET status='obsolete',lease_token=NULL,lease_owner=NULL,updated_at=? WHERE id=?`,
      )
      .bind(now, attempt.requestId),
    db
      .prepare(`UPDATE site_publication_pipeline_fence SET attempt_id=NULL,lease_token=NULL,updated_at=? WHERE id=1`)
      .bind(now),
    evidence(
      db,
      { identityType: "native_build_machine", attemptId: attempt.id, buildId: attempt.buildId },
      "superseded_before_activation",
      { versionId: attempt.versionId, sourceSequence: attempt.sourceSequence },
    ),
  ]);
  return { state: "superseded" as const };
}

/** A fresh terminal unsuccessful known build has no future machine authority. Unknown writes and activation intents remain fenced. */
export async function recoverFailedPublicationBuild(
  db: DatabaseLike,
  config: SitePublicationCoordinatorConfig,
  attemptId: string,
  token: string,
  fetcher: Parameters<typeof activateSitePublicationVersion>[3] = fetch,
) {
  const checked = sitePublicationCoordinatorConfigSchema.parse(config);
  if (!checked.enabled || !checked.exclusiveActivationOwner) return { state: "disabled" as const };
  const attempt = await readPublicationAttempt(db, attemptId);
  if (!attempt || !attempt.buildId || (attempt.phase !== "building" && attempt.phase !== "build_attested"))
    return { state: "fenced" as const };
  if (
    checked.environment !== attempt.environment ||
    checked.publicOrigin !== attempt.publicOrigin ||
    JSON.stringify(checked.provider) !== JSON.stringify(attempt.provider)
  )
    throw new Error("PUBLICATION_PROVIDER_TARGET_CHANGED");
  const proof = await inspectSitePublicationBuild(
    attempt.provider,
    token,
    {
      WORKERS_CI_BUILD_UUID: attempt.buildId,
      WORKERS_CI_BRANCH: attempt.provider.branch,
      WORKERS_CI_COMMIT_SHA: attempt.provider.commitHash,
    },
    fetcher,
  );
  if (proof.status !== "stopped" || !proof.outcome || proof.outcome === "success") return { state: "fenced" as const };
  const now = new Date().toISOString();
  const row = await first<{ attempts: number }>(db, "SELECT attempts FROM site_publication_requests WHERE id=?", [
    attempt.requestId,
  ]);
  const delay = Math.min(3600000, 60000 * 2 ** Math.min(6, Math.max(0, (row?.attempts ?? 1) - 1)));
  await db.batch([
    preparePublicationAttemptGuard(db, attempt, attempt.phase),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM site_publication_attempt_activation WHERE attempt_id=?) AND NOT EXISTS(SELECT 1 FROM site_publication_attempt_releases WHERE attempt_id=?)`,
      bindings: [attempt.id, attempt.id],
    }),
    db
      .prepare(
        `UPDATE site_publication_provider_attempts SET phase='failed',error_code='PROVIDER_BUILD_FAILED',updated_at=? WHERE id=?`,
      )
      .bind(now, attempt.id),
    db
      .prepare(
        `UPDATE site_publication_requests SET status='failed',last_error_code='PROVIDER_BUILD_FAILED',last_error_at=?,next_attempt_at=?,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?`,
      )
      .bind(now, new Date(Date.now() + delay).toISOString(), now, attempt.requestId),
    db
      .prepare(`UPDATE site_publication_pipeline_fence SET attempt_id=NULL,lease_token=NULL,updated_at=? WHERE id=1`)
      .bind(now),
    evidence(
      db,
      { identityType: "native_build_machine", attemptId: attempt.id, buildId: attempt.buildId },
      "terminal_build_failed",
      { outcome: proof.outcome, sourceSequence: attempt.sourceSequence },
    ),
  ]);
  return { state: "failed_retry_scheduled" as const };
}
