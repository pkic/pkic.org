/** Shared SQL fragments for vote ownership, sharing, visibility, and participation. */

import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import {
  groupManagementAuthorizationEvidence,
  groupManagementCandidateAuthorizationEvidence,
  groupPermissionAuthorizationEvidence,
} from "../groups/governance";
import { getResourceGrantDefinition, memberResourceGrantCapabilitiesFor } from "../resource-grants/definitions";

const VOTE_GRANTS = getResourceGrantDefinition("vote");

// Member-facing predicates intentionally exclude leadership-only `manage`.
// Capability implication remains defined once in the resource definition.
export const VOTE_VIEW_GRANT_CAPABILITIES = memberResourceGrantCapabilitiesFor(VOTE_GRANTS, "view");
export const VOTE_PARTICIPATION_GRANT_CAPABILITIES = memberResourceGrantCapabilitiesFor(VOTE_GRANTS, "participate");
export const VOTE_RESULT_GRANT_CAPABILITIES = memberResourceGrantCapabilitiesFor(VOTE_GRANTS, "view_results");

export function exactVoteGroupMembership(throughGroupId?: string): { sql: string; bindings: readonly unknown[] } {
  return throughGroupId
    ? { sql: "AND membership.group_id = ?", bindings: [throughGroupId] }
    : { sql: "", bindings: [] };
}

function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

export function voteGroupCapabilityPredicate(
  voteAlias: string,
  groupIdExpression: string,
  capabilities: readonly string[],
): string {
  return `(
    (
      ${groupIdExpression} = ${voteAlias}.owner_group_id
      AND EXISTS (
        SELECT 1 FROM groups active_owner_group
         WHERE active_owner_group.id = ${voteAlias}.owner_group_id
           AND active_owner_group.active = 1
      )
    )
    OR EXISTS (
      SELECT 1
      FROM vote_group_grants vote_grant
      JOIN groups granted_group ON granted_group.id = vote_grant.group_id AND granted_group.active = 1
      WHERE vote_grant.vote_id = ${voteAlias}.id
        AND vote_grant.group_id = ${groupIdExpression}
        AND vote_grant.capability IN (${quoted(capabilities)})
    )
  )`;
}

export function voteParticipationGroupPredicate(voteAlias: string, groupIdExpression: string): string {
  return voteGroupCapabilityPredicate(voteAlias, groupIdExpression, VOTE_PARTICIPATION_GRANT_CAPABILITIES);
}

export function voteViewGroupPredicate(voteAlias: string, groupIdExpression: string): string {
  return voteGroupCapabilityPredicate(voteAlias, groupIdExpression, VOTE_VIEW_GRANT_CAPABILITIES);
}

export function voteResultGroupPredicate(voteAlias: string, groupIdExpression: string): string {
  return voteGroupCapabilityPredicate(voteAlias, groupIdExpression, VOTE_RESULT_GRANT_CAPABILITIES);
}

interface VoteManagementContext {
  ownerGroupId: string;
}

async function resolveVoteManagementContext(db: DatabaseLike, voteId: string): Promise<VoteManagementContext | null> {
  const vote = await first<{ owner_group_id: string }>(db, "SELECT owner_group_id FROM votes WHERE id = ?", [voteId]);
  if (!vote) return null;
  return { ownerGroupId: vote.owner_group_id };
}

function managementEvidence(actor: AuthAdmin, voteId: string, context: VoteManagementContext): AuthorizationEvidence {
  const ownerVotePermission = groupPermissionAuthorizationEvidence(actor, [context.ownerGroupId], "votes:manage");
  const ownerManagement = groupManagementAuthorizationEvidence(actor, [context.ownerGroupId]);
  const grantedManagement = groupManagementCandidateAuthorizationEvidence(actor, "active_grant.group_id");
  return {
    sql: `SELECT 1
          WHERE EXISTS (${ownerVotePermission.sql})
             OR EXISTS (${ownerManagement.sql})
             OR EXISTS (
               SELECT 1
                 FROM vote_group_grants active_grant
                WHERE active_grant.vote_id = ?
                  AND active_grant.capability = 'manage'
                  AND EXISTS (${grantedManagement.sql})
             )`,
    bindings: [...ownerVotePermission.bindings, ...ownerManagement.bindings, voteId, ...grantedManagement.bindings],
  };
}

function exactManagementEvidence(
  actor: AuthAdmin,
  voteId: string,
  context: VoteManagementContext,
  throughGroupId: string,
): AuthorizationEvidence {
  const groupManagement = groupManagementAuthorizationEvidence(actor, [throughGroupId]);
  if (context.ownerGroupId === throughGroupId) {
    const votePermission = groupPermissionAuthorizationEvidence(actor, [throughGroupId], "votes:manage");
    return {
      sql: `SELECT 1
              FROM votes managed_vote
             WHERE managed_vote.id = ?
               AND managed_vote.owner_group_id = ?
               AND (EXISTS (${votePermission.sql}) OR EXISTS (${groupManagement.sql}))`,
      bindings: [voteId, throughGroupId, ...votePermission.bindings, ...groupManagement.bindings],
    };
  }
  return {
    sql: `SELECT 1
            FROM vote_group_grants active_grant
           WHERE active_grant.vote_id = ?
             AND active_grant.group_id = ?
             AND active_grant.capability = 'manage'
             AND EXISTS (${groupManagement.sql})`,
    bindings: [voteId, throughGroupId, ...groupManagement.bindings],
  };
}

export async function voteManagementAuthorizationEvidence(
  db: DatabaseLike,
  actor: AuthAdmin,
  voteId: string,
  throughGroupId?: string,
): Promise<AuthorizationEvidence | null> {
  const context = await resolveVoteManagementContext(db, voteId);
  if (!context) return null;
  return throughGroupId
    ? exactManagementEvidence(actor, voteId, context, throughGroupId)
    : managementEvidence(actor, voteId, context);
}

export async function hasVoteManagementAuthorization(
  db: DatabaseLike,
  actor: AuthAdmin,
  voteId: string,
  throughGroupId?: string,
): Promise<boolean> {
  const evidence = await voteManagementAuthorizationEvidence(db, actor, voteId, throughGroupId);
  if (!evidence) return false;
  return (
    (await first<{ authorized: number }>(db, `SELECT 1 AS authorized WHERE EXISTS (${evidence.sql})`, [
      ...evidence.bindings,
    ])) !== null
  );
}

export async function prepareVoteManagementAuthorizationGuard(
  db: DatabaseLike,
  actor: AuthAdmin,
  voteId: string,
  throughGroupId?: string,
): Promise<StatementLike> {
  const evidence = await voteManagementAuthorizationEvidence(db, actor, voteId, throughGroupId);
  return prepareAuthorizationGuard(db, evidence ?? { sql: "SELECT 1 WHERE 0", bindings: [] });
}
