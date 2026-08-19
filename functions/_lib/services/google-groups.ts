/**
 * Google Groups sync. Zero existing code prior to this —
 * confirmed by grep across the repo before writing this file.
 *
 * Every trigger point (approval onboarding, WG join/leave, deactivation)
 * writes a `google_groups_sync_queue` row via enqueueGoogleGroupsSync,
 * which never fails or blocks the caller. processGoogleGroupsSyncQueue is
 * the actual Google Admin Directory API client — a service-account JWT
 * exchanged for an OAuth access token (RS256, signed with Web Crypto, no
 * `googleapis` npm dependency, matching this codebase's existing
 * low-dependency style for Stripe/SendGrid), gated on
 * the GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY /
 * GOOGLE_WORKSPACE_ADMIN_EMAIL secrets being configured. When unconfigured (true in this dev/test environment — there
 * is no live Google Workspace to test against here), it logs and leaves
 * queued rows `pending` rather than failing them, the same graceful-degrade
 * shape other unconfigured integrations in this codebase use.
 *
 * Domain-wide delegation is required: the Directory API only allows a
 * service account to manage group membership by impersonating a real
 * Workspace admin user (GOOGLE_WORKSPACE_ADMIN_EMAIL), per Google's own
 * API model — a service account cannot call this API as itself.
 */
import { all, first, run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { logError, logInfo } from "../logging";
import type { DatabaseLike, Env, StatementLike } from "../types";

export type GoogleGroupsSyncAction = "add_to_list" | "remove_from_list";
export type GoogleGroupsSyncStatus = "pending" | "processing" | "completed" | "failed";

export interface GoogleGroupsSyncQueueRow {
  id: string;
  user_id: string;
  action: GoogleGroupsSyncAction;
  google_group_email: string;
  status: GoogleGroupsSyncStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  processed_at: string | null;
}

/** Terminal attempt count — a row still failing after this many tries is dead-lettered ('failed', no further retry). */
export const MAX_SYNC_ATTEMPTS = 5;

/** Exponential backoff (1 min, 2 min, 4 min, ...), capped at 1 hour — same shape as email_outbox's retry cadence. */
function syncRetryBackoffMs(attemptsAfterThisFailure: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** (attemptsAfterThisFailure - 1));
}

/**
 * Statement-builder form of enqueueGoogleGroupsSync, for callers folding
 * the enqueue into a larger atomic `db.batch()` instead of committing it
 * as its own round-trip — see membership/applications/approve.ts.
 */
export function buildEnqueueGoogleGroupsSyncStatement(
  db: DatabaseLike,
  params: { userId: string; googleGroupEmail: string; action: GoogleGroupsSyncAction },
): { id: string; statement: StatementLike } {
  const id = uuid();
  const statement = db
    .prepare(
      `INSERT INTO google_groups_sync_queue (id, user_id, action, google_group_email, status, attempts, last_error, created_at, processed_at)
       VALUES (?, ?, ?, ?, 'pending', 0, NULL, ?, NULL)`,
    )
    .bind(id, params.userId, params.action, params.googleGroupEmail, nowIso());
  return { id, statement };
}

export async function enqueueGoogleGroupsSync(
  db: DatabaseLike,
  params: { userId: string; googleGroupEmail: string; action: GoogleGroupsSyncAction },
): Promise<string> {
  const id = uuid();
  await run(
    db,
    `INSERT INTO google_groups_sync_queue (id, user_id, action, google_group_email, status, attempts, last_error, created_at, processed_at)
     VALUES (?, ?, ?, ?, 'pending', 0, NULL, ?, NULL)`,
    [id, params.userId, params.action, params.googleGroupEmail, nowIso()],
  );
  return id;
}

export async function listPendingGoogleGroupsSync(db: DatabaseLike, limit = 50): Promise<GoogleGroupsSyncQueueRow[]> {
  return all<GoogleGroupsSyncQueueRow>(
    db,
    `SELECT * FROM google_groups_sync_queue
     WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC LIMIT ?`,
    [nowIso(), limit],
  );
}

/**
 * Atomically claims up to `limit` pending rows: a compare-and-set `UPDATE
 * ... WHERE status = 'pending' ...` per candidate, checked via
 * `result.changes`, not a bare `SELECT` — PR #1 review Phase 9 remediation
 * pass, open question 4. Two overlapping invocations of
 * processGoogleGroupsSyncQueue (it runs off the shared 15-minute due-work
 * cron, so overlap is possible) previously both `SELECT`ed the same
 * still-`pending` rows and could both process (and double-call the
 * Directory API for) the same row before either flipped its status.
 *
 * Follows the same "UPDATE with a status guard, check `changes` to see who
 * won" idiom already used for the event-day waitlist offer claim
 * (registrations/day-waitlist.ts) rather than inventing a new
 * claim-queue pattern: whichever caller's UPDATE lands first in D1 wins the
 * row (flips it to 'processing'); the other's UPDATE matches zero rows and
 * is silently skipped. No schema change needed — 'processing' is already a
 * documented status value on this table (migrations/0041_membership_workflow.sql),
 * it was just never written.
 */
export async function claimPendingGoogleGroupsSyncRows(
  db: DatabaseLike,
  limit = 50,
): Promise<GoogleGroupsSyncQueueRow[]> {
  const candidates = await listPendingGoogleGroupsSync(db, limit);
  if (candidates.length === 0) {
    return [];
  }

  const now = nowIso();
  const claimed: GoogleGroupsSyncQueueRow[] = [];
  for (const candidate of candidates) {
    const result = await run(
      db,
      `UPDATE google_groups_sync_queue
       SET status = 'processing'
       WHERE id = ? AND status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`,
      [candidate.id, now],
    );
    if (result.changes === 1) {
      claimed.push({ ...candidate, status: "processing" });
    }
  }
  return claimed;
}

// ── Service-account JWT + Directory API REST client ──────────────────────

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlJson(value: unknown): string {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const contents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(contents);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

type GoogleServiceAccountEnv = Pick<
  Env,
  "GOOGLE_SERVICE_ACCOUNT_EMAIL" | "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY" | "GOOGLE_WORKSPACE_ADMIN_EMAIL"
>;

export function isGoogleGroupsSyncConfigured(env: GoogleServiceAccountEnv): boolean {
  return Boolean(
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY && env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
  );
}

async function getServiceAccountAccessToken(env: GoogleServiceAccountEnv): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    sub: env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
    scope: "https://www.googleapis.com/auth/admin.directory.group.member",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY as string),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token exchange failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function callDirectoryApi(
  accessToken: string,
  action: GoogleGroupsSyncAction,
  groupEmail: string,
  memberEmail: string,
): Promise<void> {
  const membersUrl = `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(groupEmail)}/members`;

  if (action === "add_to_list") {
    const response = await fetch(membersUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ email: memberEmail, role: "MEMBER" }),
    });
    // 409 = already a member — treat as success, not a failure to retry.
    if (!response.ok && response.status !== 409) {
      throw new Error(`Directory API add-member failed: HTTP ${response.status}`);
    }
    return;
  }

  const response = await fetch(`${membersUrl}/${encodeURIComponent(memberEmail)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  // 404 = already not a member — treat as success.
  if (!response.ok && response.status !== 404) {
    throw new Error(`Directory API remove-member failed: HTTP ${response.status}`);
  }
}

export interface ProcessGoogleGroupsSyncResult {
  processed: number;
  succeeded: number;
  failed: number;
  skippedUnconfigured: boolean;
  /**
   * userId -> group emails successfully added in this pass. The caller
   * (membership-scheduled-jobs.ts) uses this to queue the
   * `mailing-list-enrolled` confirmation email ("sent after
   * Google Groups sync completes") — kept out of this file so the sync
   * client stays free of email/env-outbox concerns.
   */
  completedAddsByUser: Record<string, string[]>;
}

/**
 * Processes up to `limit` pending queue rows. Called from the existing
 * 15-minute due-work cron (see membership-scheduled-jobs.ts /
 * scheduled-due-work.ts), not a dedicated cron of its own — sync is not
 * time-window-sensitive the way consultation/EC batches are.
 */
export async function processGoogleGroupsSyncQueue(
  db: DatabaseLike,
  env: GoogleServiceAccountEnv,
  limit = 25,
): Promise<ProcessGoogleGroupsSyncResult> {
  if (!isGoogleGroupsSyncConfigured(env)) {
    logInfo("google_groups_sync_skipped_unconfigured", {
      reason:
        "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY / GOOGLE_WORKSPACE_ADMIN_EMAIL not configured",
    });
    return { processed: 0, succeeded: 0, failed: 0, skippedUnconfigured: true, completedAddsByUser: {} };
  }

  const pendingCandidates = await listPendingGoogleGroupsSync(db, limit);
  if (pendingCandidates.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, skippedUnconfigured: false, completedAddsByUser: {} };
  }

  let accessToken: string;
  try {
    accessToken = await getServiceAccountAccessToken(env);
  } catch (err) {
    logError("google_groups_sync_auth_failed", { error: err instanceof Error ? err.message : String(err) });
    // Nothing was claimed yet on this path, so the candidate rows are
    // untouched and still 'pending' — safe to just return.
    return { processed: 0, succeeded: 0, failed: 0, skippedUnconfigured: false, completedAddsByUser: {} };
  }

  // Claim atomically only once we know we can actually act on the rows —
  // a concurrent invocation may have already claimed some (or all) of the
  // candidates we just peeked at; `rows` here is only what *this*
  // invocation actually won.
  const rows = await claimPendingGoogleGroupsSyncRows(db, limit);
  if (rows.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, skippedUnconfigured: false, completedAddsByUser: {} };
  }

  let succeeded = 0;
  let failed = 0;
  const completedAddsByUser: Record<string, string[]> = {};

  for (const row of rows) {
    const user = await first<{ email: string }>(db, "SELECT email FROM users WHERE id = ?", [row.user_id]);
    if (!user) {
      await run(
        db,
        `UPDATE google_groups_sync_queue SET status = 'failed', attempts = attempts + 1, last_error = ?, processed_at = ? WHERE id = ?`,
        ["User not found", nowIso(), row.id],
      );
      failed++;
      continue;
    }

    try {
      await callDirectoryApi(accessToken, row.action, row.google_group_email, user.email);
      await run(
        db,
        `UPDATE google_groups_sync_queue SET status = 'completed', attempts = attempts + 1, processed_at = ? WHERE id = ?`,
        [nowIso(), row.id],
      );
      succeeded++;
      if (row.action === "add_to_list") {
        (completedAddsByUser[row.user_id] ??= []).push(row.google_group_email);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = row.attempts + 1;
      const deadLettered = attempts >= MAX_SYNC_ATTEMPTS;
      await run(
        db,
        `UPDATE google_groups_sync_queue
         SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, processed_at = ?
         WHERE id = ?`,
        [
          deadLettered ? "failed" : "pending",
          attempts,
          message,
          deadLettered ? null : new Date(Date.now() + syncRetryBackoffMs(attempts)).toISOString(),
          deadLettered ? nowIso() : null,
          row.id,
        ],
      );
      logError("google_groups_sync_item_failed", { queueId: row.id, error: message, attempts, deadLettered });
      failed++;
    }
  }

  return { processed: rows.length, succeeded, failed, skippedUnconfigured: false, completedAddsByUser };
}
