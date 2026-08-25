import {
  groupVoteDetailSchema,
  groupVoteSchema,
  type GroupVoteDetail,
  type GroupVote,
  type GroupVotesListQuery,
} from "../../../../assets/shared/schemas/group-votes";
import type { VoteGroupCapability } from "../../../../assets/shared/schemas/resource-grants";
import { VOTES_LIST_SORT_COLUMNS } from "../../../../assets/shared/schemas/votes";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { all } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import {
  buildAccessibleGroupResourceIdsCte,
  effectiveResourceCapabilitiesForContext,
  getResourceGrantDefinition,
  isResourceGrantCapability,
  resolveGroupResourceContextAccess,
  type GroupResourceViewer,
} from "../resource-grants";
import {
  closedVoteResult,
  getVoteRowOrThrow,
  toVoteSummary,
  voteRowProjection,
  type VoteFullResult,
  type VoteResult,
  type VoteRow,
} from "./shared";
import { hydrateVotesForUser } from "./portal";

interface GroupVoteRow extends VoteRow {
  granted_capabilities: string | null;
}

function grantedCapabilities(row: GroupVoteRow): VoteGroupCapability[] {
  const definition = getResourceGrantDefinition("vote");
  return (row.granted_capabilities?.split(",") ?? []).filter((capability): capability is VoteGroupCapability =>
    isResourceGrantCapability(definition, capability),
  );
}

function effectiveVoteCapabilities(
  row: VoteRow,
  groupId: string,
  access: { member: boolean; manager: boolean },
  grants: readonly VoteGroupCapability[],
): VoteGroupCapability[] {
  return effectiveResourceCapabilitiesForContext(getResourceGrantDefinition("vote"), {
    owner: row.owner_group_id === groupId,
    member: access.member,
    manager: access.manager,
    grantedCapabilities: grants,
  });
}

function mapGroupVote(row: GroupVoteRow, groupId: string, access: { member: boolean; manager: boolean }): GroupVote {
  return groupVoteSchema.parse({
    ...toVoteSummary(row),
    capabilities: effectiveVoteCapabilities(row, groupId, access, grantedCapabilities(row)),
  });
}

async function loadVoteGrants(db: DatabaseLike, voteId: string, groupId: string): Promise<VoteGroupCapability[]> {
  const definition = getResourceGrantDefinition("vote");
  const rows = await all<{ capability: string }>(
    db,
    "SELECT capability FROM vote_group_grants WHERE vote_id = ? AND group_id = ? ORDER BY capability",
    [voteId, groupId],
  );
  return rows
    .map((row) => row.capability)
    .filter((capability): capability is VoteGroupCapability => isResourceGrantCapability(definition, capability));
}

async function resolveGroupVote(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  voteId: string,
): Promise<{ row: VoteRow; capabilities: VoteGroupCapability[] }> {
  const [row, access] = await Promise.all([
    getVoteRowOrThrow(db, voteId),
    resolveGroupResourceContextAccess(db, viewer, groupId),
  ]);
  const capabilities = effectiveVoteCapabilities(row, groupId, access, await loadVoteGrants(db, row.id, groupId));
  if (!capabilities.includes("view")) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  return { row, capabilities };
}

export function buildGroupVotesPageQuery(
  groupId: string,
  access: { member: boolean; manager: boolean },
  query: GroupVotesListQuery,
) {
  const accessibleVotes = buildAccessibleGroupResourceIdsCte("vote", groupId, access, "view");
  const conditions: string[] = [];
  const bindings: unknown[] = [...accessibleVotes.bindings, groupId];
  if (query.status?.length) {
    const status = buildD1JsonMembershipFilter("vote.status", query.status);
    conditions.push(status.sql);
    bindings.push(...status.bindings);
  }
  if (query.type) {
    conditions.push("vote.vote_type = ?");
    bindings.push(query.type);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [
      "vote.title",
      "vote.description",
      "vote.status",
      "vote.vote_type",
    ]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  return {
    sql: `WITH ${accessibleVotes.sql}
      SELECT ${voteRowProjection("vote")}, GROUP_CONCAT(DISTINCT grant_row.capability) AS granted_capabilities
        FROM accessible_resource accessible
        JOIN votes vote ON vote.id = accessible.resource_id
        LEFT JOIN vote_group_grants grant_row ON grant_row.vote_id = vote.id AND grant_row.group_id = ?
        ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
        GROUP BY vote.id`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        title: "vote.title COLLATE NOCASE",
        status: "vote.status",
        closes_at: "vote.closes_at",
        created_at: "vote.created_at",
      } satisfies Record<(typeof VOTES_LIST_SORT_COLUMNS)[number], string>,
      "vote.closes_at DESC",
      "vote.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listGroupVotes(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  query: GroupVotesListQuery,
): Promise<{ votes: GroupVote[]; total: number }> {
  const access = await resolveGroupResourceContextAccess(db, viewer, groupId);
  if (!access.member && !access.manager) return { votes: [], total: 0 };
  const page = await queryPage<GroupVoteRow>(db, buildGroupVotesPageQuery(groupId, access, query));
  return { votes: page.rows.map((row) => mapGroupVote(row, groupId, access)), total: page.total };
}

export async function getGroupVoteDetail(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  voteId: string,
): Promise<GroupVoteDetail> {
  const { row, capabilities } = await resolveGroupVote(db, viewer, groupId, voteId);
  const [hydrated] = await hydrateVotesForUser(db, [row], viewer.userId, groupId);
  const result: VoteResult =
    row.status === "closed" && capabilities.includes("view_results") ? closedVoteResult(row) : null;
  return groupVoteDetailSchema.parse({ ...hydrated, result, capabilities });
}

export async function getGroupVoteResults(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  voteId: string,
): Promise<VoteFullResult> {
  const { row, capabilities } = await resolveGroupVote(db, viewer, groupId, voteId);
  if (!capabilities.includes("view_results")) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  return closedVoteResult(row);
}
