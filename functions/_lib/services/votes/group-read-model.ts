import { nowIso } from "../../utils/time";
import { deriveVoteStatus, isVoteAcceptingBallots, voteStatusSql } from "./status";
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
import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import {
  buildAccessibleGroupResourceIdsCte,
  buildLiveAccessibleGroupResourceIdsCte,
  effectiveResourceCapabilitiesForContext,
  getResourceGrantDefinition,
  isResourceGrantCapability,
  liveGroupResourceContextAccess,
  type GroupResourceContextAccess,
  type GroupResourceViewer,
  type LiveGroupResourceContextAccess,
} from "../resource-grants";
import {
  closedVoteResult,
  toVoteSummary,
  voteRowProjection,
  type VoteFullResult,
  type VoteResult,
  type VoteRow,
} from "./shared";
import { hydrateVotesForUser } from "./member-read-model";

interface GroupVoteRow extends VoteRow {
  granted_capabilities: string | null;
  member_access: number;
  manager_access: number;
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

function contextualVoteCapabilities(
  row: VoteRow,
  capabilities: VoteGroupCapability[],
  nowMs: number,
): VoteGroupCapability[] {
  const now = new Date(nowMs).toISOString();
  // A transition in flight still blocks participation, but open-ness itself is
  // purely the schedule.
  const votingOpen = isVoteAcceptingBallots(row, now) && row.transition_processing_token === null;
  const closed = deriveVoteStatus(row, now) === "closed";
  return capabilities.filter(
    (capability) => (capability !== "participate" || votingOpen) && (capability !== "view_results" || closed),
  );
}

function availableVoteTransitions(
  row: VoteRow,
  capabilities: readonly VoteGroupCapability[],
  nowMs: number,
): GroupVote["availableTransitions"] {
  if (!capabilities.includes("manage")) return [];
  const leaseAvailable =
    row.transition_processing_token === null ||
    (row.transition_lease_expires_at !== null && Date.parse(row.transition_lease_expires_at) <= nowMs);
  const status = deriveVoteStatus(row, new Date(nowMs).toISOString());
  if (status === "scheduled") {
    return Date.parse(row.closes_at) > nowMs ? ["open", "cancel"] : ["cancel"];
  }
  return status === "open" && leaseAvailable ? ["close", "cancel"] : [];
}

function rowAccess(row: GroupVoteRow): GroupResourceContextAccess {
  return { member: row.member_access === 1, manager: row.manager_access === 1 };
}

function mapGroupVote(row: GroupVoteRow, groupId: string, nowMs: number): GroupVote {
  const capabilities = contextualVoteCapabilities(
    row,
    effectiveVoteCapabilities(row, groupId, rowAccess(row), grantedCapabilities(row)),
    nowMs,
  );
  return groupVoteSchema.parse({
    ...toVoteSummary(row),
    capabilities,
    availableTransitions: availableVoteTransitions(row, capabilities, nowMs),
  });
}

async function resolveGroupVote(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  voteId: string,
): Promise<{ row: VoteRow; capabilities: VoteGroupCapability[] }> {
  const accessibleVotes = buildLiveAccessibleGroupResourceIdsCte(
    "vote",
    groupId,
    liveGroupResourceContextAccess(viewer, groupId),
    "view",
  );
  const row = await first<GroupVoteRow>(
    db,
    `WITH ${accessibleVotes.sql}
     SELECT ${voteRowProjection("vote")}, GROUP_CONCAT(DISTINCT grant_row.capability) AS granted_capabilities,
            group_access.member_access, group_access.manager_access
       FROM accessible_resource accessible
       JOIN votes vote ON vote.id = accessible.resource_id
       CROSS JOIN group_access
       LEFT JOIN vote_group_grants grant_row ON grant_row.vote_id = vote.id AND grant_row.group_id = ?
      WHERE vote.id = ?
      GROUP BY vote.id`,
    [...accessibleVotes.bindings, groupId, voteId],
  );
  if (!row) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  const capabilities = contextualVoteCapabilities(
    row,
    effectiveVoteCapabilities(row, groupId, rowAccess(row), grantedCapabilities(row)),
    Date.now(),
  );
  if (!capabilities.includes("view")) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  return { row, capabilities };
}

export function buildGroupVotesPageQuery(
  groupId: string,
  access: GroupResourceContextAccess | LiveGroupResourceContextAccess,
  query: GroupVotesListQuery,
) {
  const live = "memberEvidence" in access;
  const accessibleVotes = live
    ? buildLiveAccessibleGroupResourceIdsCte("vote", groupId, access, "view")
    : buildAccessibleGroupResourceIdsCte("vote", groupId, access, "view");
  const conditions: string[] = [];
  const bindings: unknown[] = [...accessibleVotes.bindings, groupId];
  if (query.status?.length) {
    // Status is derived, so the filter carries the two instants the CASE needs.
    // They precede the membership binding because they appear first in the SQL.
    const now = nowIso();
    const status = buildD1JsonMembershipFilter(voteStatusSql("vote"), query.status);
    conditions.push(status.sql);
    bindings.push(now, now, ...status.bindings);
  }
  if (query.type) {
    conditions.push("vote.vote_type = ?");
    bindings.push(query.type);
  }
  if (query.ownerGroupId) {
    conditions.push("vote.owner_group_id = ?");
    bindings.push(query.ownerGroupId);
  }
  if (query.from) {
    conditions.push("vote.closes_at >= ?");
    bindings.push(query.from);
  }
  if (query.to) {
    conditions.push("vote.closes_at <= ?");
    bindings.push(query.to);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["vote.title", "vote.description", "vote.vote_type"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  return {
    sql: `WITH ${accessibleVotes.sql}
      SELECT ${voteRowProjection("vote")}, GROUP_CONCAT(DISTINCT grant_row.capability) AS granted_capabilities,
             ${live ? "group_access.member_access" : access.member ? "1" : "0"} AS member_access,
             ${live ? "group_access.manager_access" : access.manager ? "1" : "0"} AS manager_access
        FROM accessible_resource accessible
        JOIN votes vote ON vote.id = accessible.resource_id
        ${live ? "CROSS JOIN group_access" : ""}
        LEFT JOIN vote_group_grants grant_row ON grant_row.vote_id = vote.id AND grant_row.group_id = ?
        ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
        GROUP BY vote.id`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        title: "vote.title COLLATE NOCASE",
        status: `CASE
          WHEN vote.cancelled_at IS NOT NULL THEN 3
          WHEN vote.closed_at IS NOT NULL THEN 2
          ELSE 1
        END`,
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
  const page = await queryPage<GroupVoteRow>(
    db,
    buildGroupVotesPageQuery(groupId, liveGroupResourceContextAccess(viewer, groupId), query),
  );
  const nowMs = Date.now();
  return { votes: page.rows.map((row) => mapGroupVote(row, groupId, nowMs)), total: page.total };
}

export async function getGroupVoteDetail(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  voteId: string,
): Promise<GroupVoteDetail> {
  const { row, capabilities } = await resolveGroupVote(db, viewer, groupId, voteId);
  const [hydrated] = await hydrateVotesForUser(db, [row], viewer.userId, viewer.identityId ?? null, groupId);
  const result: VoteResult =
    deriveVoteStatus(row, nowIso()) === "closed" && capabilities.includes("view_results")
      ? closedVoteResult(row)
      : null;
  return groupVoteDetailSchema.parse({
    ...hydrated,
    result,
    capabilities,
    availableTransitions: availableVoteTransitions(row, capabilities, Date.now()),
  });
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
