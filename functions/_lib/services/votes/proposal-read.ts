import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import { getMembershipSettings } from "../membership-settings";
import type { DatabaseLike } from "../../types";
import type { VoteProposalStatus, VoteScopeType, VoteType } from "./shared";

export interface ProposalRow {
  id: string;
  title: string;
  description: string;
  vote_type: VoteType;
  scope_type: VoteScopeType;
  scope_id: string | null;
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

const PROPOSAL_ROW_COLUMNS =
  "id, title, description, vote_type, scope_type, scope_id, proposed_by_user_id, eligible_categories, " +
  "proposed_opens_at, proposed_closes_at, status, vote_id, rejection_reason, transition_revision, created_at, updated_at";

export interface ProposalSummary {
  id: string;
  title: string;
  description: string;
  voteType: VoteType;
  scopeType: VoteScopeType;
  scopeId: string | null;
  proposedByUserId: string;
  status: VoteProposalStatus;
  voteId: string | null;
  rejectionReason: string | null;
  endorsementCount: number;
  minEndorsersRequired: number;
  createdAt: string;
}

export async function minEndorsersFor(
  db: DatabaseLike,
  scopeType: VoteScopeType,
  scopeId: string | null,
): Promise<number> {
  if (scopeType === "forum") {
    return (await getMembershipSettings(db)).forum_vote_min_endorsers;
  }
  const wg = await first<{ min_endorsers_for_ballot: number }>(
    db,
    "SELECT min_endorsers_for_ballot FROM working_groups WHERE id = ?",
    [scopeId],
  );
  return wg?.min_endorsers_for_ballot ?? 0;
}

function mapProposalSummary(row: ProposalRow, endorsementCount: number, minEndorsersRequired: number): ProposalSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    voteType: row.vote_type,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    proposedByUserId: row.proposed_by_user_id,
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
  return mapProposalSummary(row, Number(countRow?.n ?? 0), await minEndorsersFor(db, row.scope_type, row.scope_id));
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
  const forumRows = rows.filter((row) => row.scope_type === "forum");
  const workingGroupRows = rows.filter((row) => row.scope_type === "working_group" && row.scope_id);
  if (forumRows.length > 0) {
    const threshold = (await getMembershipSettings(db)).forum_vote_min_endorsers;
    for (const row of forumRows) result.set(row.id, threshold);
  }
  if (workingGroupRows.length > 0) {
    const ids = [...new Set(workingGroupRows.map((row) => row.scope_id as string))];
    const filter = buildD1JsonMembershipFilter("id", ids);
    const groups = await all<{ id: string; min_endorsers_for_ballot: number }>(
      db,
      `SELECT id, min_endorsers_for_ballot FROM working_groups WHERE ${filter.sql}`,
      filter.bindings,
    );
    const byId = new Map(groups.map((group) => [group.id, group.min_endorsers_for_ballot]));
    for (const row of workingGroupRows) result.set(row.id, byId.get(row.scope_id as string) ?? 0);
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

export async function getProposalScopeForPermissionCheck(
  db: DatabaseLike,
  id: string,
): Promise<{ scopeType: VoteScopeType; scopeId: string | null }> {
  const row = await getProposalRowOrThrow(db, id);
  return { scopeType: row.scope_type, scopeId: row.scope_id };
}

export interface VoteProposalListParams {
  scopeType?: VoteScopeType;
  scopeId?: string;
  status?: VoteProposalStatus;
  q?: string;
  sort?: string;
  limit: number;
  offset: number;
}

async function queryProposalPage(
  db: DatabaseLike,
  params: VoteProposalListParams,
  requireDefaultOpenStatus: boolean,
): Promise<{ proposals: ProposalSummary[]; total: number }> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (params.scopeType) {
    conditions.push("scope_type = ?");
    bindings.push(params.scopeType);
  }
  if (params.scopeId) {
    conditions.push("scope_id = ?");
    bindings.push(params.scopeId);
  }
  if (params.status || requireDefaultOpenStatus) {
    conditions.push("status = ?");
    bindings.push(params.status ?? "open_for_endorsement");
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, ["title", "description", "status", "scope_type"]);
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
  const { rows, total } = await queryPage<ProposalRow>(
    db,
    {
      sql: `SELECT ${PROPOSAL_ROW_COLUMNS} FROM vote_proposals ${where} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...bindings, params.limit, params.offset],
    },
    { sql: `SELECT COUNT(*) AS total FROM vote_proposals ${where}`, bindings },
  );
  return { proposals: await toProposalSummaries(db, rows), total };
}

export function listVoteProposals(
  db: DatabaseLike,
  params: VoteProposalListParams,
): Promise<{ proposals: ProposalSummary[]; total: number }> {
  return queryProposalPage(db, params, true);
}

export function listAllVoteProposalsForAdmin(
  db: DatabaseLike,
  params: Omit<VoteProposalListParams, "scopeType" | "scopeId">,
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
