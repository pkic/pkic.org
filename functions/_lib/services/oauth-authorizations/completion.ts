import { getOAuthApi, OAuthError, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import type { Env } from "../../types";
import { all, first, run } from "../../db/queries";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { createDurableJobLease } from "../../jobs/lease";
import { AppError } from "../../errors";
import { addSeconds, nowIso, nextIsoRevision } from "../../utils/time";
import { requireInternalSecret } from "../../request";
import { logError } from "../../logging";
import { mcpOauthProviderSettings } from "../../auth/oauth/provider-settings";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { OAUTH_COMPLETION_MAX_ATTEMPTS } from "../../../../assets/shared/oauth-authorization-policy";
import { openOauthCompletion, sealOauthRedirect } from "./completion-payload";
import {
  completionAuthority,
  pendingOauthCompletionGuards,
  readClaimedOauthCompletion,
  type ClaimedOauthCompletion,
} from "./completion-authority";

async function failClaim(env: Env, row: ClaimedOauthCompletion, token: string, code: string, terminal: boolean) {
  const at = nowIso(),
    failed = terminal || row.attempts >= OAUTH_COMPLETION_MAX_ATTEMPTS;
  const next = addSeconds(at, Math.min(60, 2 ** row.attempts));
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE oauth_authorization_completions SET status=?,next_attempt_at=?,last_error_code=?,
      request_ciphertext=CASE WHEN ? THEN NULL ELSE request_ciphertext END,redirect_ciphertext=NULL,
      processing_token=NULL,lease_expires_at=NULL,updated_at=? WHERE authorization_id=? AND status='processing'
      AND processing_token=? AND lease_expires_at>?`).bind(
        failed ? "failed" : "retrying",
        next,
        code,
        failed ? 1 : 0,
        at,
        row.id,
        token,
        at,
      ),
      prepareAuditLogAfterOneChange(
        env.DB,
        "system",
        null,
        failed ? "oauth_authorization_failed" : "oauth_authorization_retry_queued",
        "oauth_authorization",
        row.id,
        { code, attempt: row.attempts },
        at,
      ),
      env.DB.prepare(
        `UPDATE oauth_authorizations SET status='failed',updated_at=? WHERE id=? AND status='pending' AND ?`,
      ).bind(nextIsoRevision(row.revision), row.id, failed ? 1 : 0),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) return "skipped" as const;
    throw error;
  }
  return failed ? ("failed" as const) : ("retrying" as const);
}
/** One retry owner. Provider writes may repeat after interruption; only the current D1 lease may activate the frozen ceiling. */
export async function processOauthAuthorizationCompletion(env: Env, id: string, provider?: OAuthHelpers) {
  const lease = createDurableJobLease();
  const claimed = await run(
    env.DB,
    `UPDATE oauth_authorization_completions SET status='processing',attempts=attempts+1,
    processing_token=?,lease_expires_at=?,updated_at=? WHERE authorization_id=? AND request_ciphertext IS NOT NULL
    AND attempt_until>? AND attempts<? AND ((status IN ('queued','retrying') AND next_attempt_at<=?)
      OR (status='processing' AND lease_expires_at<=?))
    AND EXISTS(SELECT 1 FROM oauth_authorizations WHERE id=? AND status='pending' AND expires_at>?)`,
    [
      lease.token,
      lease.expiresAt,
      lease.claimedAt,
      id,
      lease.claimedAt,
      OAUTH_COMPLETION_MAX_ATTEMPTS,
      lease.claimedAt,
      lease.claimedAt,
      id,
      lease.claimedAt,
    ],
  );
  if (claimed.changes !== 1) return "skipped" as const;
  const row = await readClaimedOauthCompletion(env.DB, id, lease.token);
  if (!row) return "skipped" as const;
  try {
    const secret = requireInternalSecret(env);
    if (!row.requestCiphertext) throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
    const payload = await openOauthCompletion(row.requestCiphertext, secret, id);
    const { actor, scopes } = await completionAuthority(env.DB, row, payload);
    await env.DB.batch(pendingOauthCompletionGuards(env.DB, row, lease.token, actor, scopes));
    const oauth =
      provider ??
      getOAuthApi(
        {
          ...mcpOauthProviderSettings(env),
          defaultHandler: { fetch: async () => new Response(null, { status: 404 }) },
        },
        env,
      );
    const { redirectTo } = await oauth.completeAuthorization({
      request: payload.request,
      userId: row.userId,
      metadata: { authorizationId: id, label: row.clientName },
      scope: payload.props.scopes,
      props: payload.props,
      // D1 approval already replaced prior authorizations. A stale provider retry must not revoke a newer grant.
      revokeExistingGrants: false,
    });
    const redirectCiphertext = await sealOauthRedirect(redirectTo, secret, id),
      at = nextIsoRevision(row.revision);
    await env.DB.batch([
      ...pendingOauthCompletionGuards(env.DB, row, lease.token, actor, scopes),
      env.DB.prepare(`UPDATE oauth_authorization_completions SET status='completed',request_ciphertext=NULL,
        redirect_ciphertext=?,processing_token=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=?
        WHERE authorization_id=? AND status='processing' AND processing_token=?`).bind(
        redirectCiphertext,
        at,
        id,
        lease.token,
      ),
      prepareAuditLogAfterOneChange(
        env.DB,
        "system",
        null,
        "oauth_authorization_completed",
        "oauth_authorization",
        id,
        {},
        at,
      ),
      env.DB.prepare(
        "UPDATE oauth_authorizations SET status='active',updated_at=? WHERE id=? AND status='pending'",
      ).bind(at, id),
    ]);
    return "completed" as const;
  } catch (error) {
    const changed =
      isAuthorizationGuardFailure(error) || (error instanceof AppError && [401, 403, 409].includes(error.status));
    const terminal =
      changed ||
      error instanceof z.ZodError ||
      (error instanceof OAuthError && !["temporarily_unavailable", "server_error"].includes(error.code));
    return failClaim(
      env,
      row,
      lease.token,
      changed ? "AUTHORIZATION_CHANGED" : error instanceof z.ZodError ? "INVALID_PAYLOAD" : "COMPLETION_FAILED",
      terminal,
    );
  }
}
export async function processOauthAuthorizationCompletionBackground(env: Env, id: string, provider?: OAuthHelpers) {
  try {
    await processOauthAuthorizationCompletion(env, id, provider);
  } catch {
    logError("OAUTH_AUTHORIZATION_COMPLETION_FAILED", { authorizationId: id });
  }
}

async function expireOauthCompletions(env: Env, at: string, limit: number, budget?: D1QueryBudget) {
  if (!hasD1QueryCapacity(budget, 2)) return 0;
  const rows = await all<{ authorization_id: string }>(
    env.DB,
    `SELECT authorization_id FROM oauth_authorization_completions
    WHERE status IN ('queued','retrying','processing') AND (attempt_until<=? OR
      (attempts>=? AND (status<>'processing' OR lease_expires_at<=?))) ORDER BY attempt_until,authorization_id LIMIT ?`,
    [at, OAUTH_COMPLETION_MAX_ATTEMPTS, at, limit],
  );
  let expired = 0;
  for (const row of rows) {
    if (!hasD1QueryCapacity(budget, 3)) break;
    try {
      await env.DB.batch([
        env.DB.prepare(`UPDATE oauth_authorization_completions SET status='failed',request_ciphertext=NULL,
        redirect_ciphertext=NULL,processing_token=NULL,lease_expires_at=NULL,last_error_code='EXPIRED',updated_at=?
        WHERE authorization_id=? AND status IN ('queued','retrying','processing') AND (attempt_until<=? OR
          (attempts>=? AND (status<>'processing' OR lease_expires_at<=?)))`).bind(
          at,
          row.authorization_id,
          at,
          OAUTH_COMPLETION_MAX_ATTEMPTS,
          at,
        ),
        prepareAuditLogAfterOneChange(
          env.DB,
          "system",
          null,
          "oauth_authorization_failed",
          "oauth_authorization",
          row.authorization_id,
          { code: "EXPIRED" },
          at,
        ),
        env.DB.prepare(
          "UPDATE oauth_authorizations SET status='failed',updated_at=? WHERE id=? AND status='pending'",
        ).bind(at, row.authorization_id),
      ]);
      expired++;
    } catch (error) {
      if (!isAuditChangeGuardFailure(error)) throw error;
    }
  }
  return expired;
}
export async function runOauthAuthorizationCompletions(env: Env, limit = 5, budget?: D1QueryBudget) {
  const bounded = Math.max(0, Math.min(20, Math.floor(limit)));
  if (!bounded) return { completed: 0, retrying: 0, failed: 0, skipped: 0, expired: 0 };
  const at = nowIso(),
    summary = {
      completed: 0,
      retrying: 0,
      failed: 0,
      skipped: 0,
      expired: await expireOauthCompletions(env, at, bounded, budget),
    };
  if (!hasD1QueryCapacity(budget, 2)) return summary;
  await run(
    env.DB,
    `UPDATE oauth_authorization_completions SET redirect_ciphertext=NULL,updated_at=?
    WHERE authorization_id IN (SELECT authorization_id FROM oauth_authorization_completions WHERE status='completed'
      AND attempt_until<=? AND redirect_ciphertext IS NOT NULL ORDER BY attempt_until,authorization_id LIMIT ?)`,
    [at, at, bounded],
  );
  if (!env.OAUTH_KV) return summary;
  const rows = await all<{ authorization_id: string }>(
    env.DB,
    `SELECT authorization_id FROM oauth_authorization_completions
    WHERE (status IN ('queued','retrying') AND next_attempt_at<=?) OR (status='processing' AND lease_expires_at<=?)
    ORDER BY next_attempt_at,authorization_id LIMIT ?`,
    [at, at, bounded],
  );
  for (const row of rows) {
    if (!hasD1QueryCapacity(budget, 20)) break;
    summary[await processOauthAuthorizationCompletion(env, row.authorization_id)]++;
  }
  return summary;
}
export async function earliestOauthCompletionDue(env: Env): Promise<string | null> {
  const row = await first<{ at: string | null }>(
    env.DB,
    `SELECT MIN(at) AS at FROM (
    SELECT CASE WHEN status='processing' THEN lease_expires_at ELSE next_attempt_at END AS at FROM oauth_authorization_completions
      WHERE status IN ('queued','retrying','processing')
    UNION ALL SELECT attempt_until FROM oauth_authorization_completions WHERE status='completed' AND redirect_ciphertext IS NOT NULL)`,
  );
  return row?.at ?? null;
}
