import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import type { ProposalReview, ProposalReviewsListQuery } from "../../../../assets/shared/schemas/proposal-reviews";
import { batchFirst, buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { getReviewContext, REVIEW_COLUMNS, REVIEW_FROM } from "./shared";

interface ReviewAggregateRow {
  total_reviews: number;
  average_score: number | null;
  accept_count: number;
  needs_work_count: number;
  reject_count: number;
}

export async function listProposalReviews(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  query: ProposalReviewsListQuery,
  minReviewsRequired: number,
) {
  const context = await getReviewContext(db, actor, proposalId);
  const search = query.q
    ? buildD1TextSearchFilter(query.q, [
        "u.email",
        "u.first_name",
        "u.last_name",
        "pr.recommendation",
        "pr.reviewer_comment",
        "pr.applicant_note",
      ])
    : null;
  const filters = ["pr.proposal_id = ?", "pr.review_round = ?"];
  const bindings: unknown[] = [proposalId, context.reviewRound];
  if (query.recommendation) {
    filters.push("pr.recommendation = ?");
    bindings.push(query.recommendation);
  }
  if (search) {
    filters.push(search.sql);
    bindings.push(...search.bindings);
  }

  const where = `WHERE ${filters.join(" AND ")}`;
  const orderBy = resolveMappedOrderBy(
    query.sort,
    {
      updatedAt: "pr.updated_at",
      reviewer: "COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.last_name, u.email) COLLATE NOCASE",
      recommendation: "pr.recommendation",
      score: "pr.score",
    },
    "pr.updated_at DESC",
    "pr.id ASC",
  );
  const [pageStatement, countStatement] = buildOffsetPageStatements(db, {
    sql: `SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM} ${where}`,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  const [pageResult, countResult, aggregateResult, myReviewResult] = await db.batch([
    pageStatement,
    countStatement,
    db
      .prepare(
        `SELECT COUNT(*) AS total_reviews,
                AVG(score) AS average_score,
                SUM(CASE WHEN recommendation = 'accept' THEN 1 ELSE 0 END) AS accept_count,
                SUM(CASE WHEN recommendation = 'needs-work' THEN 1 ELSE 0 END) AS needs_work_count,
                SUM(CASE WHEN recommendation = 'reject' THEN 1 ELSE 0 END) AS reject_count
         FROM proposal_reviews WHERE proposal_id = ? AND review_round = ?`,
      )
      .bind(proposalId, context.reviewRound),
    db
      .prepare(
        `SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM}
         WHERE pr.proposal_id = ? AND pr.review_round = ? AND pr.reviewer_user_id = ?`,
      )
      .bind(proposalId, context.reviewRound, actor.id),
  ]);

  const { rows: reviews, total } = decodeOffsetPageResults<ProposalReview>(pageResult, countResult);
  const aggregate = batchFirst<ReviewAggregateRow>(aggregateResult);
  const totalReviews = Number(aggregate?.total_reviews ?? 0);
  return {
    proposalId,
    reviews,
    myReview: batchFirst<ProposalReview>(myReviewResult),
    summary: {
      totalReviews,
      averageScore: aggregate?.average_score == null ? null : Number(aggregate.average_score),
      acceptCount: Number(aggregate?.accept_count ?? 0),
      needsWorkCount: Number(aggregate?.needs_work_count ?? 0),
      rejectCount: Number(aggregate?.reject_count ?? 0),
      minReviewsRequired,
      quorumMet: totalReviews >= minReviewsRequired,
    },
    page: buildPageInfo(query.limit, query.offset, total, reviews.length),
  };
}
