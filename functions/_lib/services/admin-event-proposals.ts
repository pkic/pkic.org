import type { z } from "zod";
import { batchFirst, batchRows } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import type { DatabaseLike } from "../types";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import type { AdminEventProposalSummary, ProposalStats } from "../../../assets/shared/schemas/admin-event-proposals";
import { adminEventProposalsQuerySchema } from "../../../assets/shared/schemas/api";
import { PROPOSAL_INACTIVE_STATUSES } from "../../../assets/shared/schemas/proposal-status";

type ProposalSort = NonNullable<z.infer<typeof adminEventProposalsQuerySchema>["sort"]>;

const ORDER_BY: Record<ProposalSort, string> = {
  submitted_desc: "sp.submitted_at DESC",
  submitted_asc: "sp.submitted_at ASC",
  score_desc: "rv.average_review_score IS NULL ASC, rv.average_review_score DESC, sp.submitted_at DESC",
  score_asc: "rv.average_review_score IS NULL ASC, rv.average_review_score ASC, sp.submitted_at DESC",
  reviews_desc: "COALESCE(rv.review_count, 0) DESC, sp.submitted_at DESC",
  reviews_asc: "COALESCE(rv.review_count, 0) ASC, sp.submitted_at DESC",
  title_desc: "LOWER(sp.title) DESC, sp.submitted_at DESC",
  title_asc: "LOWER(sp.title) ASC, sp.submitted_at DESC",
  proposer_desc:
    "LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') || ' ' || u.email) DESC, sp.submitted_at DESC",
  proposer_asc:
    "LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') || ' ' || u.email) ASC, sp.submitted_at DESC",
  type_desc: "LOWER(sp.proposal_type) DESC, sp.submitted_at DESC",
  type_asc: "LOWER(sp.proposal_type) ASC, sp.submitted_at DESC",
  status_desc: "LOWER(sp.status) DESC, sp.submitted_at DESC",
  status_asc: "LOWER(sp.status) ASC, sp.submitted_at DESC",
  decision_desc: "LOWER(COALESCE(pd.final_status, '')) DESC, sp.submitted_at DESC",
  decision_asc: "LOWER(COALESCE(pd.final_status, '')) ASC, sp.submitted_at DESC",
  recommendations_desc:
    "(COALESCE(rv.accept_count, 0) - COALESCE(rv.reject_count, 0)) DESC, COALESCE(rv.needs_work_count, 0) DESC, sp.submitted_at DESC",
  recommendations_asc:
    "(COALESCE(rv.accept_count, 0) - COALESCE(rv.reject_count, 0)) ASC, COALESCE(rv.needs_work_count, 0) ASC, sp.submitted_at DESC",
};

export async function listAdminEventProposals(
  db: DatabaseLike,
  query: {
    eventId: string;
    status?: string;
    recommendation?: string;
    sort: ProposalSort;
    q?: string;
    deleted?: "1";
    limit: number;
    offset: number;
  },
): Promise<{ proposals: AdminEventProposalSummary[]; stats: ProposalStats; page: ReturnType<typeof buildPageInfo> }> {
  const conditions = ["sp.event_id = ?", query.deleted === "1" ? "sp.deleted_at IS NOT NULL" : "sp.deleted_at IS NULL"];
  const bindings: unknown[] = [query.eventId];

  if (query.status === "active") {
    conditions.push(`sp.status NOT IN (${PROPOSAL_INACTIVE_STATUSES.map(() => "?").join(", ")})`);
    bindings.push(...PROPOSAL_INACTIVE_STATUSES);
  } else if (query.status) {
    conditions.push("sp.status = ?");
    bindings.push(query.status);
  }
  if (query.recommendation) {
    conditions.push(
      "EXISTS (SELECT 1 FROM proposal_reviews pr_filter WHERE pr_filter.proposal_id = sp.id AND pr_filter.review_round = sp.review_round AND pr_filter.recommendation = ?)",
    );
    bindings.push(query.recommendation);
  }
  if (query.q) {
    const proposal = buildD1TextSearchFilter(query.q, [
      "sp.title",
      "sp.abstract",
      "sp.proposal_type",
      "u.email",
      "u.first_name",
      "u.last_name",
      "u.first_name || ' ' || u.last_name",
    ]);
    const review = buildD1TextSearchFilter(query.q, [
      "pr_search.reviewer_comment",
      "pr_search.applicant_note",
      "pr_search.recommendation",
      "ru.email",
      "ru.first_name",
      "ru.last_name",
      "ru.first_name || ' ' || ru.last_name",
    ]);
    const decision = buildD1TextSearchFilter(query.q, ["pd_search.decision_note", "pd_search.final_status"]);
    conditions.push(`(${proposal.sql}
      OR EXISTS (
        SELECT 1 FROM proposal_reviews pr_search
        LEFT JOIN users ru ON ru.id = pr_search.reviewer_user_id
        WHERE pr_search.proposal_id = sp.id AND pr_search.review_round = sp.review_round AND ${review.sql}
      )
      OR EXISTS (
        SELECT 1 FROM proposal_decisions pd_search
        WHERE pd_search.proposal_id = sp.id AND ${decision.sql}
      ))`);
    bindings.push(...proposal.bindings, ...review.bindings, ...decision.bindings);
  }

  const where = conditions.join(" AND ");
  const deletedScope = query.deleted === "1" ? "sp.deleted_at IS NOT NULL" : "sp.deleted_at IS NULL";
  const [rowsResult, totalResult, statusResult, recommendationResult, reviewedResult] = await db.batch([
    db
      .prepare(
        `SELECT sp.id, sp.event_id, sp.proposer_user_id, sp.status, sp.proposal_type, sp.title, sp.abstract,
                sp.review_round,
                sp.submitted_at, sp.updated_at,
                u.email AS proposer_email, u.first_name AS proposer_first_name, u.last_name AS proposer_last_name,
                COALESCE(rv.review_count, 0) AS review_count,
                rv.average_review_score AS average_review_score,
                COALESCE(rv.accept_count, 0) AS recommendation_accept_count,
                COALESCE(rv.needs_work_count, 0) AS recommendation_needs_work_count,
                COALESCE(rv.reject_count, 0) AS recommendation_reject_count,
                pd.final_status AS decision_status, pd.decision_note, pd.decided_at AS decision_decided_at
         FROM session_proposals sp
         JOIN users u ON u.id = sp.proposer_user_id
         LEFT JOIN (
           SELECT proposal_id, review_round, COUNT(*) AS review_count, AVG(score) AS average_review_score,
                  SUM(CASE WHEN recommendation = 'accept' THEN 1 ELSE 0 END) AS accept_count,
                  SUM(CASE WHEN recommendation = 'needs-work' THEN 1 ELSE 0 END) AS needs_work_count,
                  SUM(CASE WHEN recommendation = 'reject' THEN 1 ELSE 0 END) AS reject_count
           FROM proposal_reviews GROUP BY proposal_id, review_round
         ) rv ON rv.proposal_id = sp.id AND rv.review_round = sp.review_round
         LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
         WHERE ${where}
         ORDER BY ${ORDER_BY[query.sort]}, sp.id ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, query.limit, query.offset),
    db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM session_proposals sp JOIN users u ON u.id = sp.proposer_user_id
         WHERE ${where}`,
      )
      .bind(...bindings),
    db
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM session_proposals sp
         WHERE sp.event_id = ? AND ${deletedScope}
         GROUP BY status`,
      )
      .bind(query.eventId),
    db
      .prepare(
        `SELECT pr.recommendation, COUNT(*) AS count
         FROM proposal_reviews pr JOIN session_proposals sp ON sp.id = pr.proposal_id
         WHERE sp.event_id = ? AND ${deletedScope} AND pr.review_round = sp.review_round
         GROUP BY pr.recommendation`,
      )
      .bind(query.eventId),
    db
      .prepare(
        `SELECT COUNT(DISTINCT sp.id) AS reviewed_count
         FROM session_proposals sp JOIN proposal_reviews pr
           ON pr.proposal_id = sp.id AND pr.review_round = sp.review_round
         WHERE sp.event_id = ? AND ${deletedScope}`,
      )
      .bind(query.eventId),
  ]);

  const proposals = batchRows<AdminEventProposalSummary>(rowsResult);
  const total = Number(batchFirst<{ total: number }>(totalResult)?.total ?? 0);
  const byStatus = Object.fromEntries(
    batchRows<{ status: string; count: number }>(statusResult).map((row) => [row.status, Number(row.count)]),
  );
  const byRecommendation = Object.fromEntries(
    batchRows<{ recommendation: string; count: number }>(recommendationResult).map((row) => [
      row.recommendation,
      Number(row.count),
    ]),
  );
  const statsTotal = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  const reviewedCount = Number(batchFirst<{ reviewed_count: number }>(reviewedResult)?.reviewed_count ?? 0);

  return {
    proposals,
    stats: {
      byStatus,
      byRecommendation,
      reviewedCount,
      unreviewedCount: Math.max(0, statsTotal - reviewedCount),
      total: statsTotal,
    },
    page: buildPageInfo(query.limit, query.offset, total, proposals.length),
  };
}
