import type { z } from "zod";
import { batchFirst, batchRows } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import type { DatabaseLike } from "../types";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import type { AdminEventProposalSummary, ProposalStats } from "../../../assets/shared/schemas/admin-event-proposals";
import { adminEventProposalsQuerySchema } from "../../../assets/shared/schemas/admin-events";
import { PROPOSAL_INACTIVE_STATUSES } from "../../../assets/shared/schemas/proposal-status";

type ProposalSort = NonNullable<z.infer<typeof adminEventProposalsQuerySchema>["sort"]>;

const SORT_EXPRESSIONS: Readonly<Record<string, string>> = {
  submittedAt: "sp.submitted_at",
  score: "rv.average_review_score",
  reviews: "COALESCE(rv.review_count, 0)",
  title: "LOWER(sp.title)",
  proposer: "LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') || ' ' || u.email)",
  type: "LOWER(sp.proposal_type)",
  status: "LOWER(sp.status)",
  decision: "LOWER(COALESCE(pd.final_status, ''))",
  recommendations: "(COALESCE(rv.accept_count, 0) - COALESCE(rv.reject_count, 0))",
};

function proposalOrderBy(sort: ProposalSort): string {
  const descending = sort.startsWith("-");
  const key = descending ? sort.slice(1) : sort;
  const expression = SORT_EXPRESSIONS[key] ?? SORT_EXPRESSIONS.submittedAt;
  const direction = descending ? "DESC" : "ASC";
  const nullsLast = key === "score" ? "rv.average_review_score IS NULL ASC, " : "";
  const recommendationTie = key === "recommendations" ? `, COALESCE(rv.needs_work_count, 0) ${direction}` : "";
  return `${nullsLast}${expression} ${direction}${recommendationTie}, sp.submitted_at DESC, sp.id ASC`;
}

interface ProposalStatsRow {
  by_status_json: string;
  by_recommendation_json: string;
  reviewed_count: number;
  total: number;
}

function parseCountRecord(value: string): Record<string, number> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, count]) => {
      const numericCount = Number(count);
      return Number.isFinite(numericCount) && numericCount >= 0 ? [[key, numericCount]] : [];
    }),
  );
}

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
  const reviewDeletedScope =
    query.deleted === "1" ? "review_sp.deleted_at IS NOT NULL" : "review_sp.deleted_at IS NULL";
  const [rowsResult, totalResult, statsResult] = await db.batch([
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
           SELECT pr.proposal_id, pr.review_round, COUNT(*) AS review_count, AVG(pr.score) AS average_review_score,
                  SUM(CASE WHEN recommendation = 'accept' THEN 1 ELSE 0 END) AS accept_count,
                  SUM(CASE WHEN recommendation = 'needs-work' THEN 1 ELSE 0 END) AS needs_work_count,
                  SUM(CASE WHEN recommendation = 'reject' THEN 1 ELSE 0 END) AS reject_count
           FROM proposal_reviews pr
           JOIN session_proposals review_sp ON review_sp.id = pr.proposal_id
           WHERE review_sp.event_id = ? AND ${reviewDeletedScope} AND pr.review_round = review_sp.review_round
           GROUP BY pr.proposal_id, pr.review_round
         ) rv ON rv.proposal_id = sp.id AND rv.review_round = sp.review_round
         LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
         WHERE ${where}
         ORDER BY ${proposalOrderBy(query.sort)}
         LIMIT ? OFFSET ?`,
      )
      .bind(query.eventId, ...bindings, query.limit, query.offset),
    db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM session_proposals sp JOIN users u ON u.id = sp.proposer_user_id
         WHERE ${where}`,
      )
      .bind(...bindings),
    db
      .prepare(
        `WITH scoped_proposals AS MATERIALIZED (
           SELECT sp.id, sp.status, sp.review_round
           FROM session_proposals sp
           WHERE sp.event_id = ? AND ${deletedScope}
         ),
         current_reviews AS MATERIALIZED (
           SELECT pr.proposal_id, pr.recommendation
           FROM scoped_proposals sp
           CROSS JOIN proposal_reviews pr INDEXED BY idx_proposal_reviews_proposal_round
           WHERE pr.proposal_id = sp.id AND pr.review_round = sp.review_round
         ),
         status_counts AS (
           SELECT status, COUNT(*) AS count FROM scoped_proposals GROUP BY status
         ),
         recommendation_counts AS (
           SELECT recommendation, COUNT(*) AS count FROM current_reviews GROUP BY recommendation
         )
         SELECT
           COALESCE((SELECT json_group_object(status, count) FROM status_counts), '{}') AS by_status_json,
           COALESCE(
             (SELECT json_group_object(recommendation, count) FROM recommendation_counts),
             '{}'
           ) AS by_recommendation_json,
           (SELECT COUNT(DISTINCT proposal_id) FROM current_reviews) AS reviewed_count,
           (SELECT COUNT(*) FROM scoped_proposals) AS total`,
      )
      .bind(query.eventId),
  ]);

  const proposals = batchRows<AdminEventProposalSummary>(rowsResult);
  const total = Number(batchFirst<{ total: number }>(totalResult)?.total ?? 0);
  const statsRow = batchFirst<ProposalStatsRow>(statsResult);
  const byStatus = parseCountRecord(statsRow?.by_status_json ?? "{}");
  const byRecommendation = parseCountRecord(statsRow?.by_recommendation_json ?? "{}");
  const statsTotal = Number(statsRow?.total ?? 0);
  const reviewedCount = Number(statsRow?.reviewed_count ?? 0);

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
