import { all, first, run } from "../../db/queries";
import { createDurableJobLease } from "../../jobs/lease";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import type {
  ClaimedGoogleGroupsSyncRow,
  EnqueueGoogleGroupsSyncParams,
  GoogleGroupsSyncAction,
  GoogleGroupsSyncQueueRow,
} from "./contracts";

const MAX_CLAIM_BATCH_SIZE = 100;
export const MAX_SYNC_ATTEMPTS = 5;

const QUEUE_COLUMNS = `
  current_row.id, current_row.user_id, current_row.action, current_row.google_group_email,
  current_row.status, current_row.attempts, current_row.idempotency_key, current_row.generation,
  current_row.last_error, current_row.next_attempt_at, current_row.created_at, current_row.processed_at,
  current_row.processing_token, current_row.lease_expires_at`;

export const GOOGLE_GROUPS_DUE_QUERY = `
  SELECT ${QUEUE_COLUMNS}, current_row.next_attempt_at AS due_at, current_row.rowid AS queue_order
    FROM google_groups_sync_queue current_row
    JOIN google_groups_membership_desired_state desired
      ON desired.user_id = current_row.user_id
     AND desired.google_group_email = current_row.google_group_email
     AND desired.generation = current_row.generation
     AND desired.desired_action = current_row.action
   WHERE current_row.status = 'pending' AND current_row.next_attempt_at <= ?
  UNION ALL
  SELECT ${QUEUE_COLUMNS}, current_row.lease_expires_at AS due_at, current_row.rowid AS queue_order
    FROM google_groups_sync_queue current_row
    JOIN google_groups_membership_desired_state desired
      ON desired.user_id = current_row.user_id
     AND desired.google_group_email = current_row.google_group_email
     AND desired.generation = current_row.generation
     AND desired.desired_action = current_row.action
   WHERE current_row.status = 'processing' AND current_row.lease_expires_at <= ?
  ORDER BY due_at, queue_order
  LIMIT ?`;

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return MAX_CLAIM_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_CLAIM_BATCH_SIZE, Math.floor(limit)));
}

function syncRetryBackoffMs(attemptsAfterThisFailure: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** (attemptsAfterThisFailure - 1));
}

export function buildEnqueueGoogleGroupsSyncStatement(
  db: DatabaseLike,
  params: EnqueueGoogleGroupsSyncParams & { onlyIfPreviousStatementChanged?: boolean },
): { id: string; statement: StatementLike } {
  const id = uuid();
  const createdAt = nowIso();
  const statement = db
    .prepare(
      `INSERT OR IGNORE INTO google_groups_sync_queue
         (id, user_id, action, google_group_email, idempotency_key, status, attempts, last_error,
          next_attempt_at, created_at, processed_at)
       SELECT ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, NULL
        WHERE ? = 0 OR changes() = 1`,
    )
    .bind(
      id,
      params.userId,
      params.action,
      params.googleGroupEmail,
      params.idempotencyKey ?? null,
      createdAt,
      createdAt,
      params.onlyIfPreviousStatementChanged ? 1 : 0,
    );
  return { id, statement };
}

export async function enqueueGoogleGroupsSync(
  db: DatabaseLike,
  params: EnqueueGoogleGroupsSyncParams,
): Promise<string> {
  const id = uuid();
  const createdAt = nowIso();
  const inserted = await run(
    db,
    `INSERT OR IGNORE INTO google_groups_sync_queue
       (id, user_id, action, google_group_email, idempotency_key, status, attempts, last_error,
        next_attempt_at, created_at, processed_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, NULL)`,
    [id, params.userId, params.action, params.googleGroupEmail, params.idempotencyKey ?? null, createdAt, createdAt],
  );
  if (inserted.changes === 1) return id;

  if (params.idempotencyKey) {
    const existing = await first<{ id: string }>(
      db,
      "SELECT id FROM google_groups_sync_queue WHERE idempotency_key = ?",
      [params.idempotencyKey],
    );
    if (existing) return existing.id;
  }
  // A generated primary-key collision is not a practical recovery case. D1's
  // `changes` metadata can also report the final trigger statement rather
  // than the top-level INSERT, so preserve the inserted UUID for unkeyed work.
  return id;
}

export async function listPendingGoogleGroupsSync(db: DatabaseLike, limit = 50): Promise<GoogleGroupsSyncQueueRow[]> {
  const at = nowIso();
  return all<GoogleGroupsSyncQueueRow>(db, GOOGLE_GROUPS_DUE_QUERY, [at, at, boundedLimit(limit)]);
}

function buildClaimStatement(
  db: DatabaseLike,
  candidate: GoogleGroupsSyncQueueRow,
  lease: ReturnType<typeof createDurableJobLease>,
): StatementLike {
  return db
    .prepare(
      `UPDATE google_groups_sync_queue
          SET status = 'processing', processing_token = ?, lease_expires_at = ?
        WHERE id = ?
          AND (
            (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
            OR (status = 'processing' AND lease_expires_at <= ?)
          )
          AND EXISTS (
            SELECT 1
              FROM google_groups_membership_desired_state desired
             WHERE desired.user_id = google_groups_sync_queue.user_id
               AND desired.google_group_email = google_groups_sync_queue.google_group_email
               AND desired.generation = google_groups_sync_queue.generation
               AND desired.desired_action = google_groups_sync_queue.action
          )`,
    )
    .bind(lease.token, lease.expiresAt, candidate.id, lease.claimedAt, lease.claimedAt);
}

export async function claimPendingGoogleGroupsSyncRows(
  db: DatabaseLike,
  limit = 50,
): Promise<ClaimedGoogleGroupsSyncRow[]> {
  const candidates = await listPendingGoogleGroupsSync(db, limit);
  if (candidates.length === 0) return [];

  const claims = candidates.map((candidate) => ({ candidate, lease: createDurableJobLease() }));
  const results = await db.batch(claims.map(({ candidate, lease }) => buildClaimStatement(db, candidate, lease)));
  return claims.flatMap(({ candidate, lease }, index) => {
    if ((results[index]?.meta?.changes ?? 0) !== 1) return [];
    return [
      {
        ...candidate,
        status: "processing" as const,
        processing_token: lease.token,
        lease_expires_at: lease.expiresAt,
      },
    ];
  });
}

export async function loadActionableGoogleGroupsSyncClaims(
  db: DatabaseLike,
  claims: ClaimedGoogleGroupsSyncRow[],
): Promise<Map<string, string | null>> {
  if (claims.length === 0) return new Map();

  const placeholders = claims.map(() => "?").join(", ");
  const rows = await all<{ id: string; processing_token: string; member_email: string | null }>(
    db,
    `SELECT queue.id, queue.processing_token, users.email AS member_email
       FROM google_groups_sync_queue queue
       JOIN google_groups_membership_desired_state desired
         ON desired.user_id = queue.user_id
        AND desired.google_group_email = queue.google_group_email
        AND desired.generation = queue.generation
        AND desired.desired_action = queue.action
       LEFT JOIN users ON users.id = queue.user_id
      WHERE queue.id IN (${placeholders}) AND queue.status = 'processing'`,
    claims.map((claim) => claim.id),
  );
  const claimTokens = new Map(claims.map((claim) => [claim.id, claim.processing_token]));
  return new Map(
    rows
      .filter((row) => claimTokens.get(row.id) === row.processing_token)
      .map((row) => [row.id, row.member_email] as const),
  );
}

export async function supersedeStaleGoogleGroupsSyncClaims(
  db: DatabaseLike,
  claims: ClaimedGoogleGroupsSyncRow[],
  actionableClaimIds: ReadonlySet<string>,
): Promise<void> {
  const stale = claims.filter((claim) => !actionableClaimIds.has(claim.id));
  if (stale.length === 0) return;

  const at = nowIso();
  await db.batch(
    stale.map((claim) =>
      db
        .prepare(
          `UPDATE google_groups_sync_queue
              SET status = 'superseded', processed_at = ?, processing_token = NULL, lease_expires_at = NULL
            WHERE id = ? AND status = 'processing' AND processing_token = ?
              AND NOT EXISTS (
                SELECT 1
                  FROM google_groups_membership_desired_state desired
                 WHERE desired.user_id = google_groups_sync_queue.user_id
                   AND desired.google_group_email = google_groups_sync_queue.google_group_email
                   AND desired.generation = google_groups_sync_queue.generation
                   AND desired.desired_action = google_groups_sync_queue.action
              )`,
        )
        .bind(at, claim.id, claim.processing_token),
    ),
  );
}

export async function failGoogleGroupsSyncClaimForMissingUser(
  db: DatabaseLike,
  claim: ClaimedGoogleGroupsSyncRow,
): Promise<boolean> {
  const result = await run(
    db,
    `UPDATE google_groups_sync_queue
        SET status = 'failed', attempts = attempts + 1, last_error = 'User not found', processed_at = ?,
            next_attempt_at = NULL, processing_token = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'processing' AND processing_token = ?`,
    [nowIso(), claim.id, claim.processing_token],
  );
  return result.changes === 1;
}

export async function completeGoogleGroupsDirectoryEffect(
  db: DatabaseLike,
  claim: ClaimedGoogleGroupsSyncRow,
): Promise<{ finalizedClaim: boolean; fulfilledCurrentDesiredState: boolean }> {
  const at = nowIso();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE google_groups_sync_queue
            SET status = 'completed', attempts = attempts + 1, processed_at = ?, next_attempt_at = NULL,
                last_error = NULL, processing_token = NULL, lease_expires_at = NULL
          WHERE id = ? AND status = 'processing' AND processing_token = ?`,
      )
      .bind(at, claim.id, claim.processing_token),
    db
      .prepare(
        `UPDATE google_groups_sync_queue AS desired_queue
            SET status = CASE WHEN desired_queue.action = ? THEN 'completed' ELSE 'pending' END,
                attempts = CASE WHEN desired_queue.action = ? THEN desired_queue.attempts ELSE 0 END,
                next_attempt_at = CASE WHEN desired_queue.action = ? THEN NULL ELSE ? END,
                last_error = NULL,
                processed_at = CASE WHEN desired_queue.action = ? THEN ? ELSE NULL END,
                processing_token = NULL, lease_expires_at = NULL
          WHERE desired_queue.user_id = ? AND desired_queue.google_group_email = ?
            AND desired_queue.generation = (
              SELECT desired.generation
                FROM google_groups_membership_desired_state desired
               WHERE desired.user_id = desired_queue.user_id
                 AND desired.google_group_email = desired_queue.google_group_email
                 AND desired.desired_action = desired_queue.action
            )
            AND (
              (desired_queue.action = ? AND desired_queue.status IN ('pending', 'processing', 'completed', 'failed'))
              OR (desired_queue.action != ? AND desired_queue.status IN ('completed', 'failed'))
            )`,
      )
      .bind(
        claim.action,
        claim.action,
        claim.action,
        at,
        claim.action,
        at,
        claim.user_id,
        claim.google_group_email,
        claim.action,
        claim.action,
      ),
    db
      .prepare(
        `SELECT desired_action
           FROM google_groups_membership_desired_state
          WHERE user_id = ? AND google_group_email = ?`,
      )
      .bind(claim.user_id, claim.google_group_email),
  ]);
  const desiredAction = (results[2]?.results?.[0] as { desired_action?: unknown } | undefined)?.desired_action;
  return {
    finalizedClaim: (results[0]?.meta?.changes ?? 0) === 1,
    fulfilledCurrentDesiredState: desiredAction === claim.action,
  };
}

export async function recordGoogleGroupsDirectoryFailure(
  db: DatabaseLike,
  claim: ClaimedGoogleGroupsSyncRow,
  error: string,
): Promise<{ finalizedClaim: boolean; attempts: number; deadLettered: boolean }> {
  const attempts = claim.attempts + 1;
  const deadLettered = attempts >= MAX_SYNC_ATTEMPTS;
  const retryAt = new Date(Date.now() + syncRetryBackoffMs(attempts)).toISOString();
  const at = nowIso();
  const isStillDesired = `EXISTS (
    SELECT 1
      FROM google_groups_membership_desired_state desired
     WHERE desired.user_id = google_groups_sync_queue.user_id
       AND desired.google_group_email = google_groups_sync_queue.google_group_email
       AND desired.generation = google_groups_sync_queue.generation
       AND desired.desired_action = google_groups_sync_queue.action
  )`;
  const result = await run(
    db,
    `UPDATE google_groups_sync_queue
        SET status = CASE WHEN NOT ${isStillDesired} THEN 'superseded' ELSE ? END,
            attempts = ?, last_error = ?,
            next_attempt_at = CASE WHEN ${isStillDesired} AND ? = 0 THEN ? ELSE NULL END,
            processed_at = CASE WHEN ${isStillDesired} AND ? = 0 THEN NULL ELSE ? END,
            processing_token = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'processing' AND processing_token = ?`,
    [
      deadLettered ? "failed" : "pending",
      attempts,
      error,
      deadLettered ? 1 : 0,
      retryAt,
      deadLettered ? 1 : 0,
      at,
      claim.id,
      claim.processing_token,
    ],
  );
  return { finalizedClaim: result.changes === 1, attempts, deadLettered };
}

export type { GoogleGroupsSyncAction, GoogleGroupsSyncQueueRow };
