import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { AuthMember, DatabaseLike, UserBackedAuthAdmin } from "../../types";
import {
  oauthClientIdentitySchema,
  oauthSelectedScopesSchema,
  oauthAuthorizationScopesSchema,
} from "../../../../assets/shared/schemas/oauth-authorizations";
import {
  oauthClientDisplayName,
  OAUTH_AUTHORIZATION_MAX_CONTEXTS,
  OAUTH_COMPLETION_WINDOW_MS,
} from "../../../../assets/shared/oauth-authorization-policy";
import { normalizeMcpOauthScopes } from "../../auth/scopes";
import { delegablePermissionContexts, oauthScopeRequirements } from "../../auth/oauth/grantable-permissions";
import { buildMcpOauthProps } from "../../auth/oauth/props";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { ownedIdentityAtEvidence } from "../identities/selection";
import { activeUserCapacityDefinitions } from "../membership/capacity-query";
import { prepareAuditLogAfterOneChange } from "../audit";
import { AppError } from "../../errors";
import { addSeconds, nowIso } from "../../utils/time";
import { sealOauthCompletion } from "./completion-payload";

/** Approval commits its immutable ceiling and completion intent in one D1 command. */
export async function approveOauthAuthorization(
  db: DatabaseLike,
  input: {
    request: AuthRequest;
    actor: UserBackedAuthAdmin;
    member: AuthMember | null;
    actingIdentityId: string | null;
    expectedActingIdentityId: string | null;
    staffIdleExpiresAt: string;
    clientName: string;
    selectedScopes: unknown;
    signingSecret: string;
  },
) {
  const selected = oauthSelectedScopesSchema.parse(input.selectedScopes);
  const requested = normalizeMcpOauthScopes(input.request.scope);
  if (selected.some((scope) => !requested.includes(scope)))
    throw new AppError(403, "SCOPE_NOT_REQUESTED", "Choose only permissions requested by this client", {
      fieldErrors: { scopes: ["Choose only permissions requested by this client"] },
    });
  const contexts = delegablePermissionContexts(input.actor, selected);
  if (selected.some((scope) => !contexts.some((context) => context.permission === scope)))
    throw new AppError(403, "SCOPE_NOT_GRANTABLE", "Your permissions changed. Review this request again.", {
      fieldErrors: { scopes: ["Choose only permissions you currently hold"] },
    });
  if (contexts.length > OAUTH_AUTHORIZATION_MAX_CONTEXTS)
    throw new AppError(400, "SCOPE_LIMIT_EXCEEDED", "Choose fewer permissions for this connection");
  const scopes = oauthAuthorizationScopesSchema.parse(contexts);
  const id = crypto.randomUUID(),
    at = nowIso();
  const expiry = Math.min(Date.parse(input.actor.expiresAt ?? ""), Date.parse(input.staffIdleExpiresAt));
  if (!input.actor.sessionId || !Number.isFinite(expiry) || expiry - Date.now() < 60000)
    throw new AppError(401, "AUTH_EXPIRED", "Sign in again to authorize this client");
  if (
    input.expectedActingIdentityId !== input.actingIdentityId ||
    (input.actor.memberId ?? null) !== (input.member?.memberId ?? null) ||
    (input.member && input.member.identityId !== input.actingIdentityId)
  )
    throw new AppError(409, "AUTHORIZATION_CONTEXT_CHANGED", "Choose your acting identity again");
  const client = oauthClientIdentitySchema.parse({
    clientId: input.request.clientId,
    clientName: oauthClientDisplayName(input.clientName, input.request.clientId),
  });
  const expiresAt =
    Date.parse(input.actor.expiresAt!) <= Date.parse(input.staffIdleExpiresAt)
      ? input.actor.expiresAt!
      : input.staffIdleExpiresAt;
  const attemptUntil = addSeconds(at, Math.min(expiry - Date.parse(at), OAUTH_COMPLETION_WINDOW_MS) / 1000);
  const props = buildMcpOauthProps(
    { ...input.actor, oauthAuthorizationId: id },
    selected,
    "oauth",
    input.staffIdleExpiresAt,
  );
  const ciphertext = await sealOauthCompletion(
    { request: { ...input.request, scope: requested }, props },
    input.signingSecret,
    id,
  );
  const requirements = oauthScopeRequirements(scopes);
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, input.actor, requirements),
      ...(input.actingIdentityId
        ? [
            prepareAuthorizationGuard(
              db,
              ownedIdentityAtEvidence({ userId: input.actor.id, identityId: input.actingIdentityId, at }),
            ),
          ]
        : []),
      ...(input.member
        ? [
            prepareAuthorizationGuard(db, {
              sql: `WITH ${activeUserCapacityDefinitions()} SELECT 1 FROM active_user_capacities WHERE identity_id=? AND member_id=?`,
              bindings: [input.actor.id, input.member.identityId, input.member.memberId],
            }),
          ]
        : []),
      db
        .prepare(`INSERT INTO oauth_authorizations(id,user_id,session_id,identity_id,member_id,client_id,client_name,status,expires_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'pending',?,?,?)`)
        .bind(
          id,
          input.actor.id,
          input.actor.sessionId,
          input.actingIdentityId,
          input.member?.memberId ?? null,
          client.clientId,
          client.clientName,
          expiresAt,
          at,
          at,
        ),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        input.actor.id,
        "oauth_authorization_approved",
        "oauth_authorization",
        id,
        { clientId: client.clientId, scopes, replacesExistingClientAuthorizations: true },
        at,
      ),
      db
        .prepare(`UPDATE oauth_authorizations SET status='revoked',updated_at=?
        WHERE user_id=? AND client_id=? AND id<>? AND status IN ('pending','active')`)
        .bind(at, input.actor.id, client.clientId, id),
      db
        .prepare(`UPDATE oauth_authorization_completions SET status='failed',request_ciphertext=NULL,
        redirect_ciphertext=NULL,processing_token=NULL,lease_expires_at=NULL,last_error_code='REPLACED',updated_at=?
        WHERE authorization_id IN (SELECT id FROM oauth_authorizations WHERE user_id=? AND client_id=? AND id<>? AND status='revoked')`)
        .bind(at, input.actor.id, client.clientId, id),
      db
        .prepare(`INSERT INTO oauth_authorization_permissions(id,authorization_id,permission,context_type,context_id)
      SELECT lower(hex(randomblob(16))),?,json_extract(value,'$.permission'),json_extract(value,'$.contextType'),json_extract(value,'$.contextId') FROM json_each(?)`)
        .bind(id, JSON.stringify(scopes)),
      db
        .prepare(`INSERT INTO oauth_authorization_completions(authorization_id,request_ciphertext,attempt_until,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?)`)
        .bind(id, ciphertext, attemptUntil, at, at, at),
      db.prepare("UPDATE scheduled_jobs SET wake_requested=1 WHERE job_key='oauth_authorization_completions'"),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(409, "AUTHORIZATION_CONTEXT_CHANGED", "Your permissions changed. Review this request again.");
    throw error;
  }
  return { authorizationId: id, status: "pending" as const };
}
