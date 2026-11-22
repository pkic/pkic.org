import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { tokenAllowsPermission } from "../../auth/permissions";
import { activeOauthAuthorizationSql, oauthPermissionCeilingSql } from "../../auth/oauth/authorization-ceiling-query";
import { scannerCapabilities } from "../../../../assets/shared/event-scanner-permissions";
import { guardAuthorizedDatabase } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import {
  sponsorLeadViewerExistsSql,
  sponsorOrganizationCaptureExistsSql,
} from "../../auth/sponsor-organization-lead-access";
/** Exact sponsor scopes never inherit global or event administrative access. */
export function sponsorLeadPermissionSql(
  permission: "agenda:leads_view" | "agenda:leads_capture" | "agenda:leads_export",
  sponsorExpression = "?",
) {
  const liveCapacity =
    permission === "agenda:leads_capture"
      ? ` OR ${sponsorOrganizationCaptureExistsSql("?", sponsorExpression)}`
      : ` OR ${sponsorLeadViewerExistsSql("?", sponsorExpression)}`;
  return `EXISTS(SELECT 1 FROM permission_grants g JOIN users operator ON operator.id=g.user_id
    WHERE g.user_id=? AND operator.active=1 AND g.permission='${permission}'
    AND g.context_type='event_sponsor' AND g.context_id=${sponsorExpression} AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
    OR EXISTS(SELECT 1 FROM user_roles role JOIN role_permissions rp ON rp.role_id=role.role_id
    JOIN users operator ON operator.id=role.user_id WHERE role.user_id=? AND operator.active=1
    AND role.member_id IS NULL AND rp.permission='${permission}'
    AND role.context_type='event_sponsor' AND role.context_id=${sponsorExpression} AND role.revoked_at IS NULL
    AND (role.expires_at IS NULL OR role.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))${liveCapacity}`;
}

/** Keep positional bindings aligned with the live sponsor permission predicate. */
export function sponsorLeadPermissionBindings(
  permission: "agenda:leads_view" | "agenda:leads_capture" | "agenda:leads_export",
  userId: string,
  sponsorId?: string,
): string[] {
  const scope = sponsorId === undefined ? [] : [sponsorId];
  const liveCapacity = permission === "agenda:leads_capture" ? [userId, ...scope] : [...scope, userId];
  return [userId, ...scope, userId, ...scope, ...liveCapacity];
}

/** Lead access needs both an exact sponsor relationship and any delegated credential's resource ceiling. */
export function sponsorLeadReadEvidence(
  actor: UserBackedAuthAdmin,
  permission: "agenda:leads_view" | "agenda:leads_capture" | "agenda:leads_export",
  sponsorExpression: string,
): AuthorizationEvidence {
  if (!tokenAllowsPermission(actor, permission)) return { sql: "0", bindings: [] };
  const sql = sponsorLeadPermissionSql(permission, sponsorExpression);
  const bindings = sponsorLeadPermissionBindings(permission, actor.id);
  if (!actor.oauthAuthorizationId) return { sql, bindings };
  return {
    sql: `(${sql}) AND EXISTS (
      WITH active_approval AS MATERIALIZED (
        SELECT authorization.id FROM oauth_authorizations authorization
        JOIN sessions session ON session.id=authorization.session_id AND session.user_id=authorization.user_id
        WHERE authorization.id=? AND authorization.user_id=? AND authorization.session_id=?
          AND session.revoked_at IS NULL AND session.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND ${activeOauthAuthorizationSql("authorization")}
      ),
      sponsor_requirement AS (
        SELECT ? AS permission, 'event_sponsor' AS context_type, ${sponsorExpression} AS context_id,
          ? AS scanner_legacy_compatible
      )
      SELECT 1 FROM active_approval approval CROSS JOIN sponsor_requirement requirement
      WHERE ${oauthPermissionCeilingSql("approval", "requirement")}
    )`,
    bindings: [
      ...bindings,
      actor.oauthAuthorizationId,
      actor.id,
      actor.sessionId ?? null,
      permission,
      (scannerCapabilities as readonly string[]).includes(permission) ? 1 : 0,
    ],
  };
}

/** Recheck exact sponsor ownership atomically, including transport receipts in the same batch. */
export function guardSponsorCaptureDatabase(
  sourceDb: DatabaseLike,
  operatorUserId: string,
  sponsorId: string,
): DatabaseLike {
  return guardAuthorizedDatabase(
    sourceDb,
    sponsorCaptureAuthorizationEvidence(operatorUserId, sponsorId),
    () => new AppError(403, "LEAD_SCOPE_REQUIRED", "An active sponsor-specific scanning relationship is required."),
  );
}

export function sponsorCaptureAuthorizationEvidence(operatorUserId: string, sponsorId: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1 WHERE (${sponsorLeadPermissionSql("agenda:leads_capture")})`,
    bindings: sponsorLeadPermissionBindings("agenda:leads_capture", operatorUserId, sponsorId),
  };
}
