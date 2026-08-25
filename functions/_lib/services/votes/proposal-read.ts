import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import type { VoteProposalStatus, VoteType } from "./shared";
import type { ListProposalsQuery, ProposalSummary } from "../../../../assets/shared/schemas/votes";
import type { AdminListProposalsQuery } from "../../../../assets/shared/schemas/votes-admin";
import { parseJsonSafe } from "../../utils/json";
import { activeGroupVoterSql } from "./voter-eligibility";

export interface ProposalRow {
  id: string;
  title: string;
  description: string;
  vote_type: VoteType;
  owner_group_id: string;
  owner_group_name: string;
  proposed_by_user_id: string;
  eligible_categories: string | null;
  proposed_opens_at: string | null;
  proposed_closes_at: string | null;
  status: VoteProposalStatus;
  vote_id: string | null;
  rejection_reason: string | null;
  transition_revision: number;
  created_at: string;
  updated_at: string;
}

export function proposalRowProjection(alias: "vote_proposals" | "proposal"): string {
  return `${alias}.id, ${alias}.title, ${alias}.description, ${alias}.vote_type, ${alias}.owner_group_id,
    (SELECT name FROM groups owner_group WHERE owner_group.id = ${alias}.owner_group_id) AS owner_group_name,
    ${alias}.proposed_by_user_id, ${alias}.eligible_categories, ${alias}.proposed_opens_at,
    ${alias}.proposed_closes_at, ${alias}.status, ${alias}.vote_id, ${alias}.rejection_reason,
    ${alias}.transition_revision, ${alias}.created_at, ${alias}.updated_at`;
}

const PROPOSAL_ROW_COLUMNS = proposalRowProjection("vote_proposals");

export async function minEndorsersFor(db: DatabaseLike, ownerGroupId: string): Promise<number> {
  const group = await first<{ min_endorsers_for_ballot: number }>(
    db,
    "SELECT min_endorsers_for_ballot FROM groups WHERE id = ? AND active = 1",
    [ownerGroupId],
  );
  return group?.min_endorsers_for_ballot ?? 0;
}

export function mapProposalSummary(
  row: ProposalRow,
  endorsementCount: number,
  minEndorsersRequired: number,
): ProposalSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    voteType: row.vote_type,
    ownerGroupId: row.owner_group_id,
    ownerGroupName: row.owner_group_name,
    proposedByUserId: row.proposed_by_user_id,
    eligibleCategories: parseJsonSafe<ProposalSummary["eligibleCategories"]>(row.eligible_categories, null),
    proposedOpensAt: row.proposed_opens_at,
    proposedClosesAt: row.proposed_closes_at,
    status: row.status,
    voteId: row.vote_id,
    rejectionReason: row.rejection_reason,
    endorsementCount,
    minEndorsersRequired,
    createdAt: row.created_at,
  };
}

export async function toProposalSummary(db: DatabaseLike, row: ProposalRow): Promise<ProposalSummary> {
  const countRow = await first<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM vote_proposal_endorsements WHERE proposal_id = ?",
    [row.id],
  );
  const minEndorsersRequired = await minEndorsersFor(db, row.owner_group_id);
  return mapProposalSummary(row, Number(countRow?.n ?? 0), minEndorsersRequired);
}

async function loadEndorsementCounts(db: DatabaseLike, proposalIds: string[]): Promise<Map<string, number>> {
  if (proposalIds.length === 0) return new Map();
  const filter = buildD1JsonMembershipFilter("proposal_id", proposalIds);
  const rows = await all<{ proposal_id: string; n: number }>(
    db,
    `SELECT proposal_id, COUNT(*) AS n FROM vote_proposal_endorsements
     WHERE ${filter.sql} GROUP BY proposal_id`,
    filter.bindings,
  );
  return new Map(rows.map((row) => [row.proposal_id, Number(row.n)]));
}

async function loadMinEndorsers(db: DatabaseLike, rows: ProposalRow[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (rows.length > 0) {
    const ids = [...new Set(rows.map((row) => row.owner_group_id))];
    const filter = buildD1JsonMembershipFilter("id", ids);
    const groups = await all<{ id: string; min_endorsers_for_ballot: number }>(
      db,
      `SELECT id, min_endorsers_for_ballot FROM groups WHERE ${filter.sql}`,
      filter.bindings,
    );
    const byId = new Map(groups.map((group) => [group.id, group.min_endorsers_for_ballot]));
    for (const row of rows) result.set(row.id, byId.get(row.owner_group_id) ?? 0);
  }
  return result;
}

async function toProposalSummaries(db: DatabaseLike, rows: ProposalRow[]): Promise<ProposalSummary[]> {
  if (rows.length === 0) return [];
  const [endorsementCounts, thresholds] = await Promise.all([
    loadEndorsementCounts(
      db,
      rows.map((row) => row.id),
    ),
    loadMinEndorsers(db, rows),
  ]);
  return rows.map((row) => mapProposalSummary(row, endorsementCounts.get(row.id) ?? 0, thresholds.get(row.id) ?? 0));
}

export async function getProposalRowOrThrow(db: DatabaseLike, id: string): Promise<ProposalRow> {
  const row = await first<ProposalRow>(db, `SELECT ${PROPOSAL_ROW_COLUMNS} FROM vote_proposals WHERE id = ?`, [id]);
  if (!row) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Vote proposal not found");
  return row;
}

export async function getProposalGroupForPermissionCheck(db: DatabaseLike, id: string): Promise<string> {
  const row = await getProposalRowOrThrow(db, id);
  return row.owner_group_id;
}

export type VoteProposalListParams = ListProposalsQuery & Partial<Pick<AdminListProposalsQuery, "status">>;
export type { ProposalSummary } from "../../../../assets/shared/schemas/votes";

async function queryProposalPage(
  db: DatabaseLike,
  params: VoteProposalListParams,
  requireDefaultOpenStatus: boolean,
  memberUserId?: string,
): Promise<{ proposals: ProposalSummary[]; total: number }> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (memberUserId) {
    conditions.push(activeGroupVoterSql("vote_proposals.owner_group_id"));
    bindings.push(memberUserId);
  }
  if (params.ownerGroupId) {
    conditions.push("owner_group_id = ?");
    bindings.push(params.ownerGroupId);
  }
  if (params.status || requireDefaultOpenStatus) {
    conditions.push("status = ?");
    bindings.push(params.status ?? "open_for_endorsement");
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, ["title", "description", "status"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveMappedOrderBy(
    params.sort,
    {
      title: "title",
      status: "status",
      endorsement_count:
        "(SELECT COUNT(*) FROM vote_proposal_endorsements vpe WHERE vpe.proposal_id = vote_proposals.id)",
      created_at: "created_at",
    },
    "created_at DESC",
    "id ASC",
  );
  const { rows, total } = await queryPage<ProposalRow>(db, {
    sql: `SELECT ${PROPOSAL_ROW_COLUMNS} FROM vote_proposals ${where}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  return { proposals: await toProposalSummaries(db, rows), total };
}

export function listVoteProposals(
  db: DatabaseLike,
  memberUserId: string,
  params: ListProposalsQuery,
): Promise<{ proposals: ProposalSummary[]; total: number }> {
  return queryProposalPage(db, params, true, memberUserId);
}

export function listAllVoteProposalsForAdmin(
  db: DatabaseLike,
  params: AdminListProposalsQuery,
): Promise<{ proposals: ProposalSummary[]; total: number }> {
  return queryProposalPage(db, params, false);
}

export async function getVoteProposalDetail(
  db: DatabaseLike,
  proposalId: string,
): Promise<{ proposal: ProposalSummary; endorserUserIds: string[] }> {
  const row = await getProposalRowOrThrow(db, proposalId);
  const endorsers = await all<{ endorser_user_id: string }>(
    db,
    "SELECT endorser_user_id FROM vote_proposal_endorsements WHERE proposal_id = ? ORDER BY endorsed_at ASC",
    [proposalId],
  );
  return { proposal: await toProposalSummary(db, row), endorserUserIds: endorsers.map((row) => row.endorser_user_id) };
}

export async function getVoteProposalDetailForMember(
  db: DatabaseLike,
  proposalId: string,
  memberUserId: string,
): Promise<{ proposal: ProposalSummary; endorserUserIds: string[] }> {
  const visible = await first<{ authorized: number }>(
    db,
    `SELECT 1 AS authorized
       FROM vote_proposals proposal
      WHERE proposal.id = ?
        AND ${activeGroupVoterSql("proposal.owner_group_id")}
      LIMIT 1`,
    [proposalId, memberUserId],
  );
  if (!visible) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Vote proposal not found");
  return getVoteProposalDetail(db, proposalId);
}
