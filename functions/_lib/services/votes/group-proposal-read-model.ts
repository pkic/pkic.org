import {
  groupVoteProposalDetailResponseSchema,
  groupVoteProposalSchema,
  type GroupVoteProposal,
  type GroupVoteProposalsListQuery,
} from "../../../../assets/shared/schemas/group-vote-proposals";
import { VOTE_PROPOSALS_LIST_SORT_COLUMNS } from "../../../../assets/shared/schemas/votes";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { groupPermissionAuthorizationEvidence } from "../groups/governance";
import type { GroupResourceViewer } from "../resource-grants";
import { mapProposalSummary, proposalRowProjection, type ProposalRow } from "./proposal-read";
import { activeGroupVoterAuthorizationEvidence } from "./voter-eligibility";

interface GroupProposalRow extends ProposalRow {
  endorsement_count: number;
  min_endorsers_required: number;
  has_endorsed: number;
  member_access: number;
  manager_access: number;
}

interface GroupProposalDetailRow extends GroupProposalRow {
  endorser_user_ids_json: string;
}

function deniedEvidence(): AuthorizationEvidence {
  return { sql: "SELECT 1 WHERE 0", bindings: [] };
}

function proposalAccessCte(viewer: GroupResourceViewer, groupId: string): { sql: string; bindings: unknown[] } {
  const member = activeGroupVoterAuthorizationEvidence(viewer.userId, groupId);
  const manager = viewer.admin
    ? groupPermissionAuthorizationEvidence(viewer.admin, [groupId], "votes:manage")
    : deniedEvidence();
  return {
    sql: `proposal_access(member_access, manager_access) AS (
      SELECT CASE WHEN EXISTS (${member.sql}) THEN 1 ELSE 0 END,
             CASE WHEN EXISTS (${manager.sql}) THEN 1 ELSE 0 END
    )`,
    bindings: [...member.bindings, ...manager.bindings],
  };
}

function mapGroupProposal(row: GroupProposalRow, viewerUserId: string): GroupVoteProposal {
  const capabilities: GroupVoteProposal["capabilities"] = ["view"];
  if (row.status === "open_for_endorsement") {
    if (row.member_access === 1) {
      capabilities.push(row.has_endorsed === 1 ? "withdraw_endorsement" : "endorse");
      if (row.proposed_by_user_id === viewerUserId) capabilities.push("withdraw");
    }
    if (row.manager_access === 1) capabilities.push("approve", "reject");
  }
  return groupVoteProposalSchema.parse({
    ...mapProposalSummary(row, Number(row.endorsement_count), Number(row.min_endorsers_required)),
    capabilities,
  });
}

export function buildGroupVoteProposalsPageQuery(
  viewer: GroupResourceViewer,
  groupId: string,
  query: GroupVoteProposalsListQuery,
) {
  const access = proposalAccessCte(viewer, groupId);
  const conditions = [
    "proposal.owner_group_id = ?",
    "(proposal_access.member_access = 1 OR proposal_access.manager_access = 1)",
    "(proposal_access.manager_access = 1 OR proposal.status = 'open_for_endorsement')",
  ];
  const bindings: unknown[] = [...access.bindings, viewer.userId, groupId];
  if (query.status) {
    conditions.push("proposal.status = ?");
    bindings.push(query.status);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["proposal.title", "proposal.description", "proposal.status"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  return {
    sql: `WITH ${access.sql}
      SELECT ${proposalRowProjection("proposal")},
             COUNT(endorsement.id) AS endorsement_count,
             COALESCE((SELECT min_endorsers_for_ballot FROM groups WHERE id = proposal.owner_group_id), 0)
               AS min_endorsers_required,
             MAX(CASE WHEN endorsement.endorser_user_id = ? THEN 1 ELSE 0 END) AS has_endorsed,
             proposal_access.member_access,
             proposal_access.manager_access
        FROM vote_proposals proposal
        CROSS JOIN proposal_access
        LEFT JOIN vote_proposal_endorsements endorsement ON endorsement.proposal_id = proposal.id
       WHERE ${conditions.join(" AND ")}
       GROUP BY proposal.id`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        title: "proposal.title COLLATE NOCASE",
        status: "proposal.status",
        endorsement_count: "endorsement_count",
        created_at: "proposal.created_at",
      } satisfies Record<(typeof VOTE_PROPOSALS_LIST_SORT_COLUMNS)[number], string>,
      "proposal.created_at DESC",
      "proposal.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listGroupVoteProposals(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  query: GroupVoteProposalsListQuery,
): Promise<{ proposals: GroupVoteProposal[]; total: number }> {
  const page = await queryPage<GroupProposalRow>(db, buildGroupVoteProposalsPageQuery(viewer, groupId, query));
  return { proposals: page.rows.map((row) => mapGroupProposal(row, viewer.userId)), total: page.total };
}

export async function getGroupVoteProposalDetail(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  proposalId: string,
): Promise<{ proposal: GroupVoteProposal; endorserUserIds: string[] }> {
  const access = proposalAccessCte(viewer, groupId);
  const row = await first<GroupProposalDetailRow>(
    db,
    `WITH ${access.sql}
     SELECT ${proposalRowProjection("proposal")},
            (SELECT COUNT(*) FROM vote_proposal_endorsements WHERE proposal_id = proposal.id)
              AS endorsement_count,
            COALESCE((SELECT min_endorsers_for_ballot FROM groups WHERE id = proposal.owner_group_id), 0)
              AS min_endorsers_required,
            CASE WHEN EXISTS (
              SELECT 1 FROM vote_proposal_endorsements own_endorsement
               WHERE own_endorsement.proposal_id = proposal.id AND own_endorsement.endorser_user_id = ?
            ) THEN 1 ELSE 0 END AS has_endorsed,
            proposal_access.member_access,
            proposal_access.manager_access,
            COALESCE((
              SELECT json_group_array(ordered_endorsement.endorser_user_id)
                FROM (
                  SELECT endorser_user_id
                    FROM vote_proposal_endorsements
                   WHERE proposal_id = proposal.id
                   ORDER BY endorsed_at ASC, id ASC
                ) ordered_endorsement
            ), '[]') AS endorser_user_ids_json
       FROM vote_proposals proposal
       CROSS JOIN proposal_access
      WHERE proposal.id = ?
        AND proposal.owner_group_id = ?
        AND (proposal_access.member_access = 1 OR proposal_access.manager_access = 1)`,
    [...access.bindings, viewer.userId, proposalId, groupId],
  );
  if (!row) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Vote proposal not found through this group");
  return groupVoteProposalDetailResponseSchema.parse({
    proposal: mapGroupProposal(row, viewer.userId),
    endorserUserIds: parseJsonSafe<string[]>(row.endorser_user_ids_json, []),
  });
}
