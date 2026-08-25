/** Shared SQL fragments for vote ownership, sharing, visibility, and participation. */

import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { groupManagementAuthorizationEvidence, groupPermissionAuthorizationEvidence } from "../groups/governance";

export const VOTE_VIEW_GRANT_CAPABILITIES = ["view", "participate", "view_results", "manage"] as const;
export const VOTE_PARTICIPATION_GRANT_CAPABILITIES = ["participate", "manage"] as const;
export const VOTE_RESULT_GRANT_CAPABILITIES = ["view_results", "manage"] as const;

function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

export function voteGroupCapabilityPredicate(
  voteAlias: string,
  groupIdExpression: string,
  capabilities: readonly string[],
): string {
  return `(
    ${groupIdExpression} = ${voteAlias}.owner_group_id
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
  managerGroupIds: string[];
}

async function resolveVoteManagementContext(db: DatabaseLike, voteId: string): Promise<VoteManagementContext | null> {
  const vote = await first<{ owner_group_id: string }>(db, "SELECT owner_group_id FROM votes WHERE id = ?", [voteId]);
  if (!vote) return null;
  const grants = await db
    .prepare("SELECT group_id FROM vote_group_grants WHERE vote_id = ? AND capability = 'manage'")
    .bind(voteId)
    .all<{ group_id: string }>();
  return { ownerGroupId: vote.owner_group_id, managerGroupIds: grants.results.map((row) => row.group_id) };
}

function managementEvidence(actor: AuthAdmin, voteId: string, context: VoteManagementContext): AuthorizationEvidence {
  const ownerVotePermission = groupPermissionAuthorizationEvidence(actor, [context.ownerGroupId], "votes:manage");
  const ownerManagement = groupManagementAuthorizationEvidence(actor, [context.ownerGroupId]);
  const grantedManagement = groupManagementAuthorizationEvidence(actor, context.managerGroupIds);
  return {
    sql: `SELECT 1
          WHERE EXISTS (${ownerVotePermission.sql})
             OR EXISTS (${ownerManagement.sql})
             OR (
               EXISTS (${grantedManagement.sql})
               AND EXISTS (
                 SELECT 1
                 FROM vote_group_grants active_grant
                 WHERE active_grant.vote_id = ?
                   AND active_grant.capability = 'manage'
                   AND active_grant.group_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
               )
             )`,
    bindings: [
      ...ownerVotePermission.bindings,
      ...ownerManagement.bindings,
      ...grantedManagement.bindings,
      voteId,
      JSON.stringify(context.managerGroupIds),
    ],
  };
}

export async function voteManagementAuthorizationEvidence(
  db: DatabaseLike,
  actor: AuthAdmin,
  voteId: string,
): Promise<AuthorizationEvidence | null> {
  const context = await resolveVoteManagementContext(db, voteId);
  return context ? managementEvidence(actor, voteId, context) : null;
}

export async function hasVoteManagementAuthorization(
  db: DatabaseLike,
  actor: AuthAdmin,
  voteId: string,
): Promise<boolean> {
  const evidence = await voteManagementAuthorizationEvidence(db, actor, voteId);
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
): Promise<StatementLike> {
  const evidence = await voteManagementAuthorizationEvidence(db, actor, voteId);
  return prepareAuthorizationGuard(db, evidence ?? { sql: "SELECT 1 WHERE 0", bindings: [] });
}
