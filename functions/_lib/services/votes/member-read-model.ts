/** Member-scoped vote discovery, detail, and results for group resource adapters. */
import type { z } from "zod";
import { nowIso } from "../../utils/time";
import { deriveVoteStatus, isVoteAcceptingBallots, voteStatusSql } from "./status";
import { loadConsultationForm, type ConsultationForm } from "./question";
import { batchRows } from "../../db/pagination";
import { sqlValue, type SqlId, type SqlSelection } from "../../db/sql-value";
import type { D1StatementResult } from "../../types";
import { queryPage } from "../../db/pagination";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import { canMemberAccessGroupResource } from "../resource-grants/access";
import { votingMembershipCategoryExistsSql } from "../membership/categories";
import {
  closedVoteResult,
  prepareCandidatesForVotes,
  getVoteRowOrThrow,
  toVoteSummary,
  VOTE_ROW_COLUMNS,
  type CandidateSummary,
  type VoteFullResult,
  type VoteResult,
  type VoteRow,
  type VoteSummary,
} from "./shared";
import { publicResultForDetailLevel } from "./public";
import {
  exactVoteGroupMembership,
  voteParticipationGroupPredicate,
  voteResultGroupPredicate,
  voteViewGroupPredicate,
} from "./vote-access";
import type { AuthMember, DatabaseLike } from "../../types";
import {
  VOTES_LIST_SORT_COLUMNS,
  type eligibleMemberBallotSchema,
  type VotesListQuery,
} from "../../../../assets/shared/schemas/votes";
import { personDisplayNameSql } from "../people/person-name-sql";

export type EligibleMemberBallot = z.infer<typeof eligibleMemberBallotSchema>;

export interface MemberVoteSummary extends VoteSummary {
  /** Resolved only on the detail read; null in list projections. */
  questionForm: ConsultationForm | null;
  candidates: CandidateSummary[] | null;
  canCastBallot: boolean;
  hasCastBallot: boolean;
  memberBallots: EligibleMemberBallot[] | null;
  result: VoteResult;
}

interface PersonBallotStatus {
  eligible: boolean;
  hasCastBallot: boolean;
}

function prepareAccessibleVoteIds(
  db: DatabaseLike,
  selection: SqlSelection,
  userId: string,
  identityId: SqlId | null,
  throughGroupId?: SqlId,
) {
  const context = exactVoteGroupMembership(throughGroupId);
  const filter = { sql: `vote.id IN (${selection.sql})`, bindings: selection.bindings };
  const identity = sqlValue(identityId);
  const statement = db
    .prepare(
      `SELECT DISTINCT vote.id AS vote_id
     FROM votes vote
     JOIN group_memberships membership
      ON membership.user_id = ?
      AND membership.identity_id = ${identity.sql}
      AND membership.left_at IS NULL
      ${context.sql}
      AND ${voteResultGroupPredicate("vote", "membership.group_id")}
     WHERE ${filter.sql}`,
    )
    .bind(userId, ...identity.bindings, ...context.bindings, ...filter.bindings);
  return {
    statement,
    decode(loaded: D1StatementResult): Set<string> {
      const rows = batchRows<{ vote_id: string }>(loaded);

      return new Set(rows.map((row) => row.vote_id));
    },
  };
}

function prepareEligibleMemberBallots(
  db: DatabaseLike,
  selection: SqlSelection,
  userId: string,
  identityId: SqlId | null,
  throughGroupId?: SqlId,
) {
  const context = exactVoteGroupMembership(throughGroupId);
  const filter = { sql: `vote.id IN (${selection.sql})`, bindings: selection.bindings };
  const identity = sqlValue(identityId);
  const statement = db
    .prepare(
      `SELECT DISTINCT vote.id AS vote_id, membership.member_id,
            organization.name AS organization_name, ballot.id AS ballot_id,
            ballot.choice AS ballot_choice, ballot.updated_at AS ballot_updated_at,
            ballot.user_id AS ballot_user_id,
            ${personDisplayNameSql("caster", "Another representative")} AS ballot_cast_by_name
     FROM votes vote
     JOIN group_memberships membership
      ON membership.user_id = ?
      AND membership.identity_id = ${identity.sql}
      AND membership.left_at IS NULL
      ${context.sql}
      AND ${voteParticipationGroupPredicate("vote", "membership.group_id")}
     JOIN members represented_member
       ON represented_member.id = membership.member_id
      AND represented_member.status = 'active'
      AND represented_member.organization_id IS NOT NULL
     JOIN organizations organization ON organization.id = represented_member.organization_id
     JOIN member_category_assignments category ON category.member_id = represented_member.id
     JOIN identities identity
       ON identity.id = membership.identity_id
      AND identity.user_id = membership.user_id
      AND identity.started_at IS NOT NULL
      AND identity.ended_at IS NULL
      AND identity.blocked_at IS NULL
     LEFT JOIN vote_ballots ballot
       ON ballot.vote_id = vote.id
      AND ballot.member_id = membership.member_id
      AND ballot.round = vote.current_round
     LEFT JOIN users caster ON caster.id = ballot.user_id
     WHERE vote.electorate_mode = 'per_member'
       AND ${filter.sql}
       AND ${votingMembershipCategoryExistsSql("category.category_code")}
       AND (
         vote.eligible_categories IS NULL
         OR EXISTS (
           SELECT 1 FROM json_each(vote.eligible_categories) allowed
           WHERE allowed.value = category.category_code
         )
       )
     ORDER BY vote.id, organization.name COLLATE NOCASE, membership.member_id`,
    )
    .bind(userId, ...identity.bindings, ...context.bindings, ...filter.bindings);
  return {
    statement,
    decode(loaded: D1StatementResult): Map<string, EligibleMemberBallot[]> {
      const rows = batchRows<{
        vote_id: string;
        member_id: string;
        organization_name: string;
        ballot_id: string | null;
        ballot_choice: string | null;
        ballot_updated_at: string | null;
        ballot_user_id: string | null;
        ballot_cast_by_name: string | null;
      }>(loaded);

      const byVoteId = new Map<string, EligibleMemberBallot[]>();
      for (const row of rows) {
        const ballots = byVoteId.get(row.vote_id) ?? [];
        ballots.push({
          memberId: row.member_id,
          organizationName: row.organization_name,
          hasCastBallot: row.ballot_id !== null,
          recorded:
            row.ballot_id === null
              ? null
              : {
                  choice: row.ballot_choice!,
                  castByName: row.ballot_cast_by_name!,
                  castByYou: row.ballot_user_id === userId,
                  castAt: row.ballot_updated_at!,
                },
        });
        byVoteId.set(row.vote_id, ballots);
      }
      return byVoteId;
    },
  };
}

function preparePersonBallotStatuses(
  db: DatabaseLike,
  selection: SqlSelection,
  userId: string,
  identityId: SqlId | null,
  throughGroupId?: SqlId,
) {
  const context = exactVoteGroupMembership(throughGroupId);
  const filter = { sql: `vote.id IN (${selection.sql})`, bindings: selection.bindings };
  const identity = sqlValue(identityId);
  const statement = db
    .prepare(
      `SELECT vote.id AS vote_id, MAX(ballot.id) AS ballot_id
     FROM votes vote
     JOIN group_memberships membership
      ON membership.user_id = ?
      AND membership.identity_id = ${identity.sql}
      AND membership.left_at IS NULL
      ${context.sql}
      AND ${voteParticipationGroupPredicate("vote", "membership.group_id")}
     JOIN members represented_member
       ON represented_member.id = membership.member_id
      AND represented_member.status = 'active'
     JOIN member_category_assignments category
       ON category.member_id = represented_member.id
     LEFT JOIN vote_ballots ballot
       ON ballot.vote_id = vote.id
      AND ballot.user_id = ?
      AND ballot.member_id IS NULL
      AND ballot.round = vote.current_round
     WHERE vote.electorate_mode = 'per_person'
       AND ${filter.sql}
       AND ${votingMembershipCategoryExistsSql("category.category_code")}
       AND (
         vote.eligible_categories IS NULL
         OR EXISTS (
           SELECT 1 FROM json_each(vote.eligible_categories) allowed
           WHERE allowed.value = category.category_code
         )
       )
     GROUP BY vote.id`,
    )
    .bind(userId, ...identity.bindings, ...context.bindings, userId, ...filter.bindings);
  return {
    statement,
    decode(loaded: D1StatementResult): Map<string, PersonBallotStatus> {
      const rows = batchRows<{ vote_id: string; ballot_id: string | null }>(loaded);

      const result = new Map<string, PersonBallotStatus>();
      for (const row of rows) result.set(row.vote_id, { eligible: true, hasCastBallot: row.ballot_id !== null });
      return result;
    },
  };
}

export async function hydrateVotesForUser(
  db: DatabaseLike,
  rows: VoteRow[],
  userId: string,
  identityId: string | null,
  throughGroupId?: SqlId,
): Promise<MemberVoteSummary[]> {
  if (rows.length === 0) return [];
  const read = prepareVoteHydration(
    db,
    {
      sql: "SELECT value FROM json_each(?)",
      bindings: [JSON.stringify(rows.map((row) => row.id))],
    },
    userId,
    identityId,
    throughGroupId,
  );
  return read.decode(await db.batch(read.statements), rows);
}

/** Hydration composes with the selected page and authentication in the caller's serving snapshot. */
export function prepareVoteHydration(
  db: DatabaseLike,
  selection: SqlSelection,
  userId: string,
  identityId: SqlId | null,
  throughGroupId?: SqlId,
) {
  const candidates = prepareCandidatesForVotes(db, selection);
  const memberBallots = prepareEligibleMemberBallots(db, selection, userId, identityId, throughGroupId);
  const persons = preparePersonBallotStatuses(db, selection, userId, identityId, throughGroupId);
  const access = prepareAccessibleVoteIds(db, selection, userId, identityId, throughGroupId);
  return {
    statements: [candidates.statement, memberBallots.statement, persons.statement, access.statement],
    decode(results: D1StatementResult[], rows: VoteRow[]): MemberVoteSummary[] {
      const candidatesByVoteId = candidates.decode(results[0]);
      const memberBallotsByVoteId = memberBallots.decode(results[1]);
      const personStatuses = persons.decode(results[2]);
      const accessibleVoteIds = access.decode(results[3]);

      const now = nowIso();
      return rows.map((row) => {
        const open = isVoteAcceptingBallots(row, now);
        const memberBallots = row.electorate_mode === "per_member" ? (memberBallotsByVoteId.get(row.id) ?? []) : null;
        const personStatus = personStatuses.get(row.id) ?? { eligible: false, hasCastBallot: false };
        const canCastBallot = open && (memberBallots ? memberBallots.length > 0 : personStatus.eligible);
        const hasCastBallot = memberBallots
          ? memberBallots.some((ballot) => ballot.hasCastBallot)
          : personStatus.hasCastBallot;
        const result =
          deriveVoteStatus(row, now) !== "closed"
            ? null
            : accessibleVoteIds.has(row.id)
              ? closedVoteResult(row)
              : row.visibility === "public"
                ? publicResultForDetailLevel(row)
                : null;
        return {
          ...toVoteSummary(row),
          candidates: row.vote_type === "election" ? (candidatesByVoteId.get(row.id) ?? []) : null,
          canCastBallot,
          hasCastBallot,
          memberBallots,
          // Resolved only in the detail read: a list of votes has no use for
          // every consultation's full field definitions, and loading them per row
          // would turn one page into a query per vote.
          questionForm: null,
          result,
        };
      });
    },
  };
}

/** Votes visible publicly or through membership in an owner/grantee group. */
export function buildVisibleVotesForMemberPageQuery(userId: string, params: VotesListQuery) {
  const filters = [
    `(votes.visibility = 'public' OR EXISTS (
       SELECT 1
       FROM group_memberships membership
       WHERE membership.user_id = ?
         AND membership.left_at IS NULL
         AND ${voteViewGroupPredicate("votes", "membership.group_id")}
     ))`,
  ];
  const bindings: unknown[] = [userId];
  if (params.type) {
    filters.push("votes.vote_type = ?");
    bindings.push(params.type);
  }
  if (params.ownerGroupId) {
    filters.push("votes.owner_group_id = ?");
    bindings.push(params.ownerGroupId);
  }
  if (params.status && params.status.length > 0) {
    // Vote status is derived, never stored; filter through the shared SQL rule.
    const now = nowIso();
    const statusFilter = buildD1JsonMembershipFilter(voteStatusSql("votes"), params.status);
    filters.push(statusFilter.sql);
    bindings.push(now, now, ...statusFilter.bindings);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, ["votes.title", "votes.description", "votes.vote_type"]);
    filters.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (params.from) {
    filters.push("votes.closes_at >= ?");
    bindings.push(params.from);
  }
  if (params.to) {
    filters.push("votes.closes_at <= ?");
    bindings.push(params.to);
  }
  const orderBy = resolveOrderBy(params.sort, VOTES_LIST_SORT_COLUMNS, "ORDER BY closes_at DESC", "id ASC");
  return {
    sql: `SELECT ${VOTE_ROW_COLUMNS} FROM votes WHERE ${filters.join(" AND ")}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  };
}

export async function listVisibleVotesForMember(db: DatabaseLike, member: AuthMember, params: VotesListQuery) {
  const { rows, total } = await queryPage<VoteRow>(db, buildVisibleVotesForMemberPageQuery(member.userId, params));
  return { votes: await hydrateVotesForUser(db, rows, member.userId, member.identityId), total };
}

export async function getVoteDetailForMember(
  db: DatabaseLike,
  member: AuthMember,
  voteIdOrSlug: string,
): Promise<MemberVoteSummary> {
  const row = await getVoteRowOrThrow(db, voteIdOrSlug);
  if (row.visibility !== "public" && !(await canMemberAccessGroupResource(db, member.userId, "vote", row.id, "view"))) {
    throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  }
  const [vote] = await hydrateVotesForUser(db, [row], member.userId, member.identityId);
  // The questions themselves, projected through the shared form reader so the
  // portal renders a consultation with the ordinary form components.
  return { ...vote, questionForm: await loadConsultationForm(db, row) };
}

export async function getVoteResultsForMember(
  db: DatabaseLike,
  member: AuthMember,
  voteIdOrSlug: string,
): Promise<VoteFullResult> {
  const row = await getVoteRowOrThrow(db, voteIdOrSlug);
  if (!(await canMemberAccessGroupResource(db, member.userId, "vote", row.id, "view_results"))) {
    throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  }
  return closedVoteResult(row);
}
