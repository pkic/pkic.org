import { agendaSnapshotSchema } from "../../../assets/shared/schemas/event-agenda";
import {
  SITE_PUBLICATION_FULL_REPAIR_PREFIX,
  SITE_PUBLICATION_REPAIR_INTERVAL_SECONDS,
  sitePublicationCoordinatorConfigSchema,
  type SitePublicationAttempt,
  type SitePublicationCoordinatorConfig,
} from "../../../assets/shared/schemas/site-publication-coordinator";
import { utcInstantSchema } from "../../../assets/shared/schemas/api-common";
import { all, first } from "../db/queries";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { prepareSitePublicationRequest } from "./site-publication-requests";

const REPAIR_BATCH_LIMIT = 25;
type ApprovedBasis = { eventId: string; slug: string; revision: number; snapshotJson: string };
type IdleBasis = { desiredSequence: number; deliveredSequence: number; attemptId: string | null };
const approvedColumns = `state.event_id AS eventId,event.slug,publication.revision,publication.snapshot_json AS snapshotJson`;
const approvedSource = `FROM event_agenda_state state JOIN events event ON event.id=state.event_id
  JOIN event_agenda_publications publication ON publication.event_id=state.event_id
  AND publication.revision=state.published_revision`;
function assertApprovedBasis(rows: ApprovedBasis[]): void {
  for (const row of rows) {
    const snapshot = agendaSnapshotSchema.parse(JSON.parse(row.snapshotJson));
    utcInstantSchema.parse(snapshot.approvedAt);
    if (
      snapshot.revision !== row.revision ||
      snapshot.publishedRevision !== row.revision ||
      snapshot.eventSlug !== row.slug
    )
      throw new Error("PUBLICATION_REPAIR_APPROVAL_BASIS_INVALID");
  }
}
function prepareIdleGuard(db: DatabaseLike, idle: IdleBasis) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM site_publication_delivery_state state JOIN site_publication_pipeline_fence fence ON fence.id=1
      WHERE state.id=1 AND state.desired_sequence=? AND state.delivered_sequence=?
      AND state.desired_sequence=state.delivered_sequence AND fence.attempt_id IS NULL`,
    bindings: [idle.desiredSequence, idle.deliveredSequence],
  });
}
function prepareApprovedGuard(db: DatabaseLike, rows: ApprovedBasis[]) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
      SELECT 1 ${approvedSource} WHERE state.event_id=json_extract(expected.value,'$.eventId')
      AND event.slug=json_extract(expected.value,'$.slug')
      AND publication.revision=json_extract(expected.value,'$.revision')
      AND publication.snapshot_json=json_extract(expected.value,'$.snapshotJson')))`,
    bindings: [JSON.stringify(rows)],
  });
}
function result(state: string, candidatesChecked = 0, approvalRepairsQueued = 0, fullRepairQueued = false) {
  return { state, candidatesChecked, approvalRepairsQueued, fullRepairQueued };
}

/** Repair creates durable render intents only; it neither approves drafts nor repeats consumer side effects. */
export async function reconcileSitePublication(
  db: DatabaseLike,
  config: SitePublicationCoordinatorConfig,
  at = nowIso(),
) {
  const checked = sitePublicationCoordinatorConfigSchema.parse(config);
  if (!checked.enabled || !checked.exclusiveActivationOwner) return result("disabled");
  const now = utcInstantSchema.parse(at);
  const idle = await first<IdleBasis>(
    db,
    `SELECT state.desired_sequence AS desiredSequence,state.delivered_sequence AS deliveredSequence,
      fence.attempt_id AS attemptId FROM site_publication_delivery_state state
      JOIN site_publication_pipeline_fence fence ON fence.id=1 WHERE state.id=1`,
  );
  if (!idle) throw new Error("PUBLICATION_REPAIR_LEDGER_UNAVAILABLE");
  if (idle.desiredSequence !== idle.deliveredSequence || idle.attemptId !== null) return result("delivery_pending");
  const missing = await all<ApprovedBasis>(
    db,
    `SELECT ${approvedColumns} ${approvedSource} WHERE NOT EXISTS(
      SELECT 1 FROM site_publication_requests request WHERE request.resource_type='event_agenda'
      AND request.resource_id=state.event_id AND request.revision=state.published_revision)
      ORDER BY state.event_id LIMIT ?`,
    [REPAIR_BATCH_LIMIT],
  );
  assertApprovedBasis(missing);
  if (missing.length) {
    try {
      const written = await db.batch([
        prepareIdleGuard(db, idle),
        prepareApprovedGuard(db, missing),
        prepareAuthorizationGuard(db, {
          sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE EXISTS(
            SELECT 1 FROM site_publication_requests request WHERE request.resource_type='event_agenda'
            AND request.resource_id=json_extract(expected.value,'$.eventId')
            AND request.revision=json_extract(expected.value,'$.revision')))`,
          bindings: [JSON.stringify(missing)],
        }),
        ...missing.map((row) =>
          prepareSitePublicationRequest(db, {
            resourceType: "event_agenda",
            resourceId: row.eventId,
            revision: row.revision,
            reasonCode: "repair",
            deduplicationKey: `repair:approval:${row.eventId}:${row.revision}`,
          }),
        ),
      ]);
      const queued = written.slice(3).reduce((count, row) => count + ((row.meta?.changes ?? 0) > 0 ? 1 : 0), 0);
      return result("approval_repairs_queued", missing.length, queued);
    } catch (error) {
      if (isAuthorizationGuardFailure(error)) return result("authority_changed", missing.length);
      throw error;
    }
  }
  const interval = checked.repairIntervalSeconds ?? SITE_PUBLICATION_REPAIR_INTERVAL_SECONDS;
  const period = Math.floor(Date.parse(now) / (interval * 1000));
  const key = `${SITE_PUBLICATION_FULL_REPAIR_PREFIX}${interval}:${period}`;
  if (await first(db, "SELECT id FROM site_publication_requests WHERE deduplication_key=?", [key]))
    return result("up_to_date");
  const anchor = await first<ApprovedBasis>(
    db,
    `SELECT ${approvedColumns} ${approvedSource} ORDER BY state.event_id LIMIT 1`,
  );
  if (!anchor) return result("no_approved_agenda");
  assertApprovedBasis([anchor]);
  try {
    const written = await db.batch([
      prepareIdleGuard(db, idle),
      prepareApprovedGuard(db, [anchor]),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM site_publication_requests WHERE deduplication_key=?)",
        bindings: [key],
      }),
      prepareSitePublicationRequest(db, {
        resourceType: "event_agenda",
        resourceId: anchor.eventId,
        revision: anchor.revision,
        reasonCode: "repair",
        deduplicationKey: key,
      }),
    ]);
    return result("full_repair_queued", 1, 0, (written[3]?.meta?.changes ?? 0) > 0);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) return result("authority_changed", 1);
    throw error;
  }
}

/** Only the pinned native machine can derive force mode from undelivered immutable repair intents. */
export async function readOwnedPublicationRepairMode(
  db: DatabaseLike,
  attempt: SitePublicationAttempt,
  buildId: string,
): Promise<boolean> {
  const rows = await db.batch([
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM site_publication_pipeline_fence fence
        JOIN site_publication_provider_attempts attempt ON attempt.id=fence.attempt_id
        JOIN site_publication_delivery_state state ON state.id=1 WHERE fence.id=1
        AND attempt.id=? AND fence.lease_token=? AND attempt.lease_token=fence.lease_token
        AND attempt.source_sequence=? AND state.desired_sequence=attempt.source_sequence
        AND state.delivered_sequence<attempt.source_sequence AND attempt.build_id=? AND attempt.phase='build_attested'
        AND attempt.environment=? AND attempt.public_origin=? AND attempt.provider_json=?`,
      bindings: [
        attempt.id,
        attempt.leaseToken,
        attempt.sourceSequence,
        buildId,
        attempt.environment,
        attempt.publicOrigin,
        JSON.stringify(attempt.provider),
      ],
    }),
    db
      .prepare(
        `SELECT EXISTS(SELECT 1 FROM site_publication_requests request
          JOIN site_publication_delivery_state state ON state.id=1
          WHERE request.sequence>state.delivered_sequence AND request.sequence<=?
          AND request.reason_code='repair' AND substr(request.deduplication_key,1,?)=?) AS forceRebuild`,
      )
      .bind(attempt.sourceSequence, SITE_PUBLICATION_FULL_REPAIR_PREFIX.length, SITE_PUBLICATION_FULL_REPAIR_PREFIX),
  ]);
  const row = rows[1]?.results?.[0] as { forceRebuild?: number } | undefined;
  if (row?.forceRebuild !== 0 && row?.forceRebuild !== 1) throw new Error("PUBLICATION_REPAIR_MODE_UNAVAILABLE");
  return row.forceRebuild === 1;
}
