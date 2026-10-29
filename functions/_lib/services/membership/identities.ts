/** Sparse approved Member identity persistence and lifecycle statement builders. */
import type { z } from "zod";
import { identitySourceSchema } from "../../../../assets/shared/schemas/identity";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareIdentityEmailOwnershipStatements, requireIdentityEmailAssignable } from "../identities/email-ownership";
import { identityCreationSelections } from "../identities/creation-read";

export type IdentitySource = z.infer<typeof identitySourceSchema>;

export interface MemberIdentity {
  id: string;
  memberId: string;
  userId: string;
  organizationId: string | null;
  emailId: string | null;
  jobTitle: string | null;
  biography: string | null;
  linksJson: string | null;
  source: IdentitySource;
  showOnOrganizationProfile: boolean;
  invitedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  blockedAt: string | null;
  blockedByUserId: string | null;
  predecessorIdentityId: string | null;
}

interface IdentityRow {
  id: string;
  member_id: string;
  user_id: string;
  organization_id: string | null;
  email_id: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  source: IdentitySource;
  show_on_organization_profile: number;
  invited_at: string;
  started_at: string | null;
  ended_at: string | null;
  blocked_at: string | null;
  blocked_by_user_id: string | null;
  predecessor_identity_id: string | null;
}

const IDENTITY_COLUMNS = `identity.id, capacity.member_id, identity.user_id, identity.organization_id,
  identity.email_id, identity.job_title, identity.biography, identity.links_json, identity.source,
  identity.show_on_organization_profile, identity.invited_at, identity.started_at,
  identity.ended_at, identity.blocked_at, identity.blocked_by_user_id,
  identity.predecessor_identity_id`;

function toIdentity(row: IdentityRow): MemberIdentity {
  return {
    id: row.id,
    memberId: row.member_id,
    userId: row.user_id,
    organizationId: row.organization_id,
    emailId: row.email_id,
    jobTitle: row.job_title,
    biography: row.biography,
    linksJson: row.links_json,
    source: row.source,
    showOnOrganizationProfile: row.show_on_organization_profile === 1,
    invitedAt: row.invited_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    blockedAt: row.blocked_at,
    blockedByUserId: row.blocked_by_user_id,
    predecessorIdentityId: row.predecessor_identity_id,
  };
}

function sameScopePredicate(organizationId: string | null): { sql: string; binding: string[] } {
  return organizationId === null
    ? { sql: "organization_id IS NULL", binding: [] }
    : { sql: "organization_id = ?", binding: [organizationId] };
}

/**
 * Builds one identity INSERT without committing it. When it selects a work
 * address, `emailOwnership` records the new identity as that address's owner;
 * the caller places those statements after the insert and its audit row. Ended rows are immutable
 * history; a later role period creates a successor instead of restoring or
 * overwriting the old row.
 */
export async function buildCreateIdentityStatement(
  db: DatabaseLike,
  input: {
    userId: string;
    organizationId: string | null;
    source: IdentitySource;
    emailId?: string | null;
    verifiedEmailDomain?: string | null;
    jobTitle?: string | null;
    biography?: string | null;
    linksJson?: string | null;
    showOnOrganizationProfile?: boolean;
    startImmediately: boolean;
    predecessorIdentityId?: string | null;
    now?: string;
    condition?: AuthorizationEvidence;
  },
  observed?: {
    unresolved: { id: string; started_at: string | null; blocked_at: string | null } | null;
    latest: { id: string } | null;
    emailOwner: { identity_id: string | null } | null;
  },
): Promise<{ identityId: string; statement: StatementLike; emailOwnership: StatementLike[] }> {
  if (input.verifiedEmailDomain != null && (input.source !== "verified_email" || input.organizationId === null))
    throw new AppError(422, "IDENTITY_PROOF_DOMAIN_INVALID", "Only verified-email affiliations retain a proof domain");
  const at = input.now ?? nowIso();
  const scope = sameScopePredicate(input.organizationId);
  const reads = identityCreationSelections(input.userId, input.organizationId);
  const unresolved = observed
    ? observed.unresolved
    : await first<{ id: string; started_at: string | null; blocked_at: string | null }>(
        db,
        reads.unresolved.sql,
        reads.unresolved.bindings,
      );
  if (unresolved?.blocked_at) {
    throw new AppError(409, "IDENTITY_BLOCKED", "This identity is blocked and requires an explicit reviewed successor");
  }
  if (unresolved) {
    throw new AppError(
      409,
      unresolved.started_at ? "IDENTITY_ALREADY_ACTIVE" : "IDENTITY_INVITATION_PENDING",
      unresolved.started_at ? "This identity is already active" : "An identity invitation is already pending",
    );
  }

  const latest = observed ? observed.latest : await first<{ id: string }>(db, reads.latest.sql, reads.latest.bindings);
  const identityId = uuid();
  const predecessorIdentityId = input.predecessorIdentityId ?? latest?.id ?? null;
  const ownership = {
    userId: input.userId,
    emailId: input.emailId,
    identityId,
    transferFromIdentityId: predecessorIdentityId,
  };
  await requireIdentityEmailAssignable(db, { ...ownership, identityId: null }, observed?.emailOwner);
  const showOnOrganizationProfile = input.organizationId !== null && input.showOnOrganizationProfile !== false ? 1 : 0;
  const values = [
    identityId,
    input.userId,
    input.organizationId,
    input.emailId ?? null,
    input.verifiedEmailDomain ?? null,
    input.organizationId === null ? null : (input.jobTitle ?? null),
    input.biography ?? null,
    input.linksJson ?? null,
    input.source,
    showOnOrganizationProfile,
    at,
    input.startImmediately ? at : null,
    predecessorIdentityId,
    at,
    at,
    predecessorIdentityId,
    input.userId,
  ];
  const columns = `(id, user_id, organization_id, email_id, verified_email_domain, job_title, biography, links_json,
    source, show_on_organization_profile, invited_at, started_at,
    predecessor_identity_id, created_at, updated_at, hidden_from_public_profile)`;
  // Read the flag in the committing INSERT, so a concurrent staff decision is preserved.
  const valuesSql = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    COALESCE((SELECT predecessor.hidden_from_public_profile FROM identities predecessor
      WHERE predecessor.id = ? AND predecessor.user_id = ?), 0)`;
  const statement = input.condition
    ? db
        .prepare(
          `INSERT INTO identities ${columns}
           SELECT ${valuesSql}
            WHERE EXISTS (${input.condition.sql})
              AND NOT EXISTS (
                SELECT 1 FROM identities existing
                 WHERE existing.user_id = ? AND ${scope.sql}
                   AND existing.ended_at IS NULL
              )`,
        )
        .bind(...values, ...input.condition.bindings, input.userId, ...scope.binding)
    : db.prepare(`INSERT INTO identities ${columns} VALUES (${valuesSql})`).bind(...values);
  return { identityId, statement, emailOwnership: prepareIdentityEmailOwnershipStatements(db, ownership) };
}

export function buildEndIdentityStatement(
  db: DatabaseLike,
  input: { identityId: string; now?: string },
): StatementLike {
  const at = input.now ?? nowIso();
  return db
    .prepare(
      `UPDATE identities SET ended_at = ?, updated_at = ?
       WHERE id = ? AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
    )
    .bind(at, at, input.identityId);
}

export async function isActiveIdentity(
  db: DatabaseLike,
  organizationId: string | null,
  userId: string,
): Promise<boolean> {
  const scope = sameScopePredicate(organizationId);
  return (
    (await first<{ id: string }>(
      db,
      `SELECT id FROM identities
        WHERE user_id = ? AND ${scope.sql}
          AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
      [userId, ...scope.binding],
    )) !== null
  );
}

export async function isActiveIdentityForMember(db: DatabaseLike, memberId: string, userId: string): Promise<boolean> {
  return (
    (await first<{ id: string }>(
      db,
      `SELECT identity.id
         FROM identities identity
         JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
        WHERE capacity.member_id = ? AND identity.user_id = ?
          AND identity.started_at IS NOT NULL
          AND identity.ended_at IS NULL
          AND identity.blocked_at IS NULL
        LIMIT 1`,
      [memberId, userId],
    )) !== null
  );
}

export async function listActiveIdentitiesForMember(db: DatabaseLike, memberId: string): Promise<MemberIdentity[]> {
  const rows = await all<IdentityRow>(
    db,
    `SELECT ${IDENTITY_COLUMNS}
       FROM identities identity
       JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
      WHERE capacity.member_id = ?
        AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
      ORDER BY identity.started_at ASC, identity.id ASC`,
    [memberId],
  );
  return rows.map(toIdentity);
}

export async function listActiveIdentitiesForUser(db: DatabaseLike, userId: string): Promise<MemberIdentity[]> {
  const rows = await all<IdentityRow>(
    db,
    `SELECT ${IDENTITY_COLUMNS}
       FROM identities identity
       JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
      WHERE identity.user_id = ?
        AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
      ORDER BY identity.started_at ASC, identity.id ASC`,
    [userId],
  );
  return rows.map(toIdentity);
}
