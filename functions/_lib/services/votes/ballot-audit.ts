import { buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { resolveMappedOrderBy } from "../../db/sort";
import { buildD1TextSearchFilter } from "../../db/search";
import { personDisplayNameSql } from "../people/person-name-sql";
import { BALLOT_CHOICE_LABELS } from "../../../../assets/shared/schemas/votes";
import { getVoteRowOrThrow } from "./shared";
import { prepareVoteManagementAuthorizationGuard } from "./vote-access";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, D1StatementResult } from "../../types";
import {
  RAW_VOTE_BALLOT_SORT_COLUMNS,
  type RawVoteBallot,
  type RawVoteBallotsListQuery,
} from "../../../../assets/shared/schemas/vote-management";
// ── Managed raw ballot audit ──────────────────────────────────────────

export type AdminBallotRow = RawVoteBallot;

interface AdminBallotDbRow {
  id: string;
  user_id: string;
  voter_name: string;
  member_id: string | null;
  member_name: string | null;
  choice: string;
  candidate_name: string | null;
  round: number;
  submitted_at: string;
  updated_at: string;
}

const VOTER_NAME_SQL = personDisplayNameSql("voter", "Former participant");
/** The choice as the audit table shows it: the candidate's name, or the motion choice in words. */
const BALLOT_CHOICE_DISPLAY_SQL = `COALESCE(candidate.candidate_name, CASE b.choice ${Object.entries(
  BALLOT_CHOICE_LABELS,
)
  .map(([value, label]) => `WHEN '${value}' THEN '${label.replaceAll("'", "''")}'`)
  .join(" ")} ELSE b.choice END)`;

const ADMIN_BALLOT_SORT_COLUMNS = {
  submittedAt: "b.submitted_at",
  round: "b.round",
  choice: BALLOT_CHOICE_DISPLAY_SQL,
  voterName: "voter_name",
  memberName: "member_name",
} as const satisfies Record<(typeof RAW_VOTE_BALLOT_SORT_COLUMNS)[number], string>;

export function prepareBallotAudit(db: DatabaseLike, voteId: string, query: RawVoteBallotsListQuery) {
  const conditions = ["b.vote_id = ?"];
  const bindings: unknown[] = [voteId];
  if (query.round !== undefined) {
    conditions.push("b.round = ?");
    bindings.push(query.round);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [
      VOTER_NAME_SQL,
      "organization.name",
      BALLOT_CHOICE_DISPLAY_SQL,
      "b.round",
    ]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderBy = resolveMappedOrderBy(query.sort, ADMIN_BALLOT_SORT_COLUMNS, "b.submitted_at DESC", "b.id ASC");
  const pageQuery = {
    sql: `SELECT b.id, b.user_id, ${VOTER_NAME_SQL} AS voter_name, b.member_id,
                   organization.name AS member_name, b.choice, candidate.candidate_name, b.round,
                   b.submitted_at, b.updated_at
              FROM vote_ballots b
              JOIN users voter ON voter.id = b.user_id
              LEFT JOIN members member ON member.id = b.member_id
              LEFT JOIN organizations organization ON organization.id = member.organization_id
              LEFT JOIN vote_candidates candidate ON candidate.id = b.choice AND candidate.vote_id = b.vote_id
              ${where}`,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  };
  return {
    statements: buildOffsetPageStatements(db, pageQuery),
    decode(results: D1StatementResult[]) {
      const { rows, total } = decodeOffsetPageResults<AdminBallotDbRow>(results[0], results[1]);
      const ballots = rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        voterName: r.voter_name,
        memberId: r.member_id,
        memberName: r.member_name,
        choice: r.choice,
        candidateName: r.candidate_name,
        round: r.round,
        submittedAt: r.submitted_at,
        updatedAt: r.updated_at,
      }));
      return { ballots, page: buildPageInfo(query.limit, query.offset, total, ballots.length) };
    },
  };
}

export async function listBallotsForManager(
  db: DatabaseLike,
  actor: AuthAdmin,
  voteId: string,
  query: RawVoteBallotsListQuery,
  throughGroupId?: string,
): Promise<{ ballots: AdminBallotRow[]; page: PageInfo }> {
  await getVoteRowOrThrow(db, voteId);
  const read = prepareBallotAudit(db, voteId, query);
  try {
    const [, ...results] = await db.batch([
      await prepareVoteManagementAuthorizationGuard(db, actor, voteId, throughGroupId),
      ...read.statements,
    ]);
    return read.decode(results);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(409, "VOTE_MANAGEMENT_CHANGED", "Vote management permission changed before the ballot read");
    throw error;
  }
}
