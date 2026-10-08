import { first } from "../../db/queries";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { proposalActingIdentitySnapshotSchema } from "../../../../assets/shared/schemas/proposal-acting-identity";

export interface OwnedIdentityAtInput {
  userId: string;
  identityId: string;
  at: string;
  expectedUpdatedAt?: string;
  organizationName?: string | null;
}

/** Trusted internal SQL expressions only; bind caller values rather than interpolating them. */
export function ownedIdentityLifecycleSql(identityAlias: string, atSql: string | null): string {
  if (atSql === null)
    return `${identityAlias}.started_at IS NOT NULL
    AND ${identityAlias}.ended_at IS NULL AND ${identityAlias}.blocked_at IS NULL`;
  return `${identityAlias}.started_at IS NOT NULL AND ${identityAlias}.started_at <= ${atSql}
    AND (${identityAlias}.ended_at IS NULL OR ${identityAlias}.ended_at > ${atSql})
    AND (${identityAlias}.blocked_at IS NULL OR ${identityAlias}.blocked_at > ${atSql})`;
}

/** Lifecycle is evaluated at the use case's actual instant, never an event-wide date. */
export function ownedIdentityAtEvidence(input: OwnedIdentityAtInput): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM identities identity
      LEFT JOIN organizations organization ON organization.id = identity.organization_id
      WHERE identity.id = ? AND identity.user_id = ?
        AND ${ownedIdentityLifecycleSql("identity", "?")}
        ${input.expectedUpdatedAt === undefined ? "" : "AND identity.updated_at = ?"}
        ${input.organizationName === undefined ? "" : "AND organization.name IS ?"}`,
    bindings: [
      input.identityId,
      input.userId,
      input.at,
      input.at,
      input.at,
      ...(input.expectedUpdatedAt === undefined ? [] : [input.expectedUpdatedAt]),
      ...(input.organizationName === undefined ? [] : [input.organizationName]),
    ],
  };
}

export async function resolveOwnedIdentityAt(db: DatabaseLike, input: OwnedIdentityAtInput) {
  const evidence = ownedIdentityAtEvidence(input);
  const row = await first<{
    id: string;
    user_id: string;
    updated_at: string;
    organization_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
  }>(
    db,
    `SELECT identity.id, identity.user_id, identity.updated_at,
      organization.name AS organization_name, identity.job_title, identity.biography, identity.links_json
    FROM identities identity LEFT JOIN organizations organization ON organization.id = identity.organization_id
    WHERE identity.id = ? AND EXISTS (${evidence.sql})`,
    [input.identityId, ...evidence.bindings],
  );
  if (!row)
    throw new AppError(403, "PROPOSAL_IDENTITY_UNAVAILABLE", "Choose an identity owned by you and valid at this date.");
  return {
    id: row.id,
    userId: row.user_id,
    updatedAt: row.updated_at,
    snapshot: proposalActingIdentitySnapshotSchema.parse({
      organizationName: row.organization_name,
      jobTitle: row.job_title,
      biography: row.biography,
      links: parseLinksJson(row.links_json),
    }),
  };
}
