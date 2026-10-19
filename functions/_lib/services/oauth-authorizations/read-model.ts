import { guardUserSessionDatabase, type OwnAccount } from "../../auth/member";
import type { DatabaseLike } from "../../types";
import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  oauthAuthorizationSchema,
  oauthAuthorizationScopesResponseSchema,
  type OauthAuthorization,
  type OauthAuthorizationsQuery,
  type OauthAuthorizationScopesQuery,
} from "../../../../assets/shared/schemas/oauth-authorizations";
import { PERMISSION_METADATA } from "../../../../assets/shared/permission-metadata";

const STATUS_SQL =
  "CASE WHEN authorization.status IN ('pending','active') AND authorization.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'expired' ELSE authorization.status END";
const AUTHORIZATION_COLUMNS = `authorization.id,authorization.client_id AS clientId,authorization.client_name AS clientName,
  ${STATUS_SQL} AS status,authorization.created_at AS createdAt,authorization.expires_at AS expiresAt,
  authorization.updated_at AS revision,(SELECT COUNT(*) FROM oauth_authorization_permissions scope
    WHERE scope.authorization_id=authorization.id) AS scopeCount`;
export type OwnedOauthAuthorization = OauthAuthorization & {
  sessionId: string;
  identityId: string | null;
  rawStatus: string;
};

export async function getOwnedOauthAuthorization(
  db: DatabaseLike,
  userId: string,
  id: string,
): Promise<OwnedOauthAuthorization> {
  const row = await first<OwnedOauthAuthorization>(
    db,
    `SELECT ${AUTHORIZATION_COLUMNS},authorization.session_id AS sessionId,
    authorization.identity_id AS identityId,authorization.status AS rawStatus FROM oauth_authorizations authorization
    WHERE authorization.id=? AND authorization.user_id=?`,
    [id, userId],
  );
  if (!row) throw new AppError(404, "OAUTH_AUTHORIZATION_NOT_FOUND", "Authorization not found");
  oauthAuthorizationSchema.parse(row);
  return row;
}
export async function listOwnedOauthAuthorizations(
  db: DatabaseLike,
  account: OwnAccount,
  query: OauthAuthorizationsQuery,
) {
  db = guardUserSessionDatabase(db, account);
  const clauses = ["authorization.user_id=?"],
    bindings: unknown[] = [account.userId];
  if (query.status) {
    clauses.push(`(${STATUS_SQL})=?`);
    bindings.push(query.status);
  }
  if (query.q) {
    const filter = buildD1TextSearchFilter(query.q, ["authorization.client_name", "authorization.client_id"]);
    clauses.push(filter.sql);
    bindings.push(...filter.bindings);
  }
  const { rows, total } = await queryPage<OauthAuthorization>(db, {
    source: {
      selectSql: `SELECT ${AUTHORIZATION_COLUMNS}`,
      fromSql: `FROM oauth_authorizations authorization WHERE ${clauses.join(" AND ")}`,
      bindings,
    },
    limit: query.limit,
    offset: query.offset,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        clientName: "authorization.client_name",
        createdAt: "authorization.created_at",
        expiresAt: "authorization.expires_at",
      },
      "authorization.created_at DESC",
      "authorization.id ASC",
    ),
  });
  return {
    authorizations: rows.map((row) => oauthAuthorizationSchema.parse(row)),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  };
}

const PERMISSION_CATALOG = JSON.stringify(
  Object.entries(PERMISSION_METADATA).map(([permission, metadata]) => ({ permission, ...metadata })),
);
/** Names come from the live resource; the authorization stores only its stable context identifier. */
export async function listOwnedOauthAuthorizationScopes(
  db: DatabaseLike,
  account: OwnAccount,
  id: string,
  query: OauthAuthorizationScopesQuery,
) {
  db = guardUserSessionDatabase(db, account);
  await getOwnedOauthAuthorization(db, account.userId, id);
  const clauses = ["authorization.user_id=?", "scope.authorization_id=?"],
    bindings: unknown[] = [PERMISSION_CATALOG, account.userId, id];
  if (query.domain) {
    clauses.push("json_extract(metadata.value,'$.domain')=?");
    bindings.push(query.domain);
  }
  if (query.access) {
    clauses.push("json_extract(metadata.value,'$.access')=?");
    bindings.push(query.access);
  }
  const contextName =
    "CASE scope.context_type WHEN 'event' THEN event.name WHEN 'group' THEN group_record.name WHEN 'organization' THEN organization.name WHEN 'event_sponsor' THEN COALESCE(sponsor_organization.name,sponsorship.non_member_name) END";
  if (query.q) {
    const filter = buildD1TextSearchFilter(query.q, [
      "scope.permission",
      contextName,
      "json_extract(metadata.value,'$.label')",
    ]);
    clauses.push(filter.sql);
    bindings.push(...filter.bindings);
  }
  const { rows, total } = await queryPage(db, {
    source: {
      selectSql: `SELECT scope.permission,scope.context_type AS contextType,scope.context_id AS contextId,
        json_extract(metadata.value,'$.label') AS label,json_extract(metadata.value,'$.domain') AS domain,
        json_extract(metadata.value,'$.access') AS access,${contextName} AS contextName`,
      fromSql: `FROM oauth_authorization_permissions scope JOIN oauth_authorizations authorization ON authorization.id=scope.authorization_id
        JOIN json_each(?) metadata ON json_extract(metadata.value,'$.permission')=scope.permission
        LEFT JOIN events event ON scope.context_type='event' AND event.id=scope.context_id
        LEFT JOIN groups group_record ON scope.context_type='group' AND group_record.id=scope.context_id
        LEFT JOIN organizations organization ON scope.context_type='organization' AND organization.id=scope.context_id
        LEFT JOIN sponsorships sponsorship ON scope.context_type='event_sponsor' AND sponsorship.id=scope.context_id
        LEFT JOIN organizations sponsor_organization ON sponsor_organization.id=sponsorship.organization_id
        WHERE ${clauses.join(" AND ")}`,
      bindings,
    },
    limit: query.limit,
    offset: query.offset,
    orderBy: resolveMappedOrderBy(
      query.sort,
      { permission: "scope.permission", contextName },
      "scope.permission ASC",
      "scope.context_type ASC,scope.context_id ASC,scope.id ASC",
    ),
  });
  return oauthAuthorizationScopesResponseSchema.parse({
    scopes: rows,
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}

export async function reviewOwnedOauthAuthorization(db: DatabaseLike, account: OwnAccount, id: string) {
  return {
    authorization: oauthAuthorizationSchema.parse(
      await getOwnedOauthAuthorization(guardUserSessionDatabase(db, account), account.userId, id),
    ),
  };
}
