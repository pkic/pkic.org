import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all, first } from "../../../../../_lib/db/queries";
import type { ProposalListRecord } from "../../../../../_lib/services/proposals";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { adminEventProposalsQuerySchema, eventSlugParamsSchema } from "../../../../../../assets/shared/schemas/api";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const access = await getProposalAccessForEvent(requestDb(c), event.id, admin);

  const url = new URL(c.req.raw.url);
  const status = url.searchParams.get("status")?.trim() ?? "";
  const recommendation = url.searchParams.get("recommendation")?.trim() ?? "";
  const sort = url.searchParams.get("sort")?.trim() ?? "submitted_desc";
  const search = (url.searchParams.get("q") ?? url.searchParams.get("search") ?? "").trim().toLowerCase();
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  const showDeleted = url.searchParams.get("deleted") === "1";
  const conditions: string[] = ["sp.event_id = ?", showDeleted ? "sp.deleted_at IS NOT NULL" : "sp.deleted_at IS NULL"];
  const params: unknown[] = [event.id];

  if (status) {
    conditions.push("sp.status = ?");
    params.push(status);
  }

  if (recommendation) {
    conditions.push(
      "EXISTS (SELECT 1 FROM proposal_reviews pr_filter WHERE pr_filter.proposal_id = sp.id AND pr_filter.recommendation = ?)",
    );
    params.push(recommendation);
  }

  if (search) {
    conditions.push(
      `(LOWER(sp.title) LIKE ?
        OR LOWER(sp.abstract) LIKE ?
        OR LOWER(sp.proposal_type) LIKE ?
        OR LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') || ' ' || u.email) LIKE ?
        OR EXISTS (
          SELECT 1
          FROM proposal_reviews pr_search
          LEFT JOIN users ru ON ru.id = pr_search.reviewer_user_id
          WHERE pr_search.proposal_id = sp.id
            AND (
              LOWER(COALESCE(pr_search.reviewer_comment, '')) LIKE ?
              OR LOWER(COALESCE(pr_search.applicant_note, '')) LIKE ?
              OR LOWER(pr_search.recommendation) LIKE ?
              OR LOWER(COALESCE(ru.first_name, '') || ' ' || COALESCE(ru.last_name, '') || ' ' || COALESCE(ru.email, '')) LIKE ?
            )
        )
        OR EXISTS (
          SELECT 1
          FROM proposal_decisions pd_search
          WHERE pd_search.proposal_id = sp.id
            AND LOWER(COALESCE(pd_search.decision_note, '') || ' ' || COALESCE(pd_search.final_status, '')) LIKE ?
        ))`,
    );
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }

  const orderByMap: Record<string, string> = {
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
  const orderBy = orderByMap[sort] ?? orderByMap.submitted_desc;

  const rows = await all<ProposalListRecord>(
    requestDb(c),
    `SELECT
       sp.*,
       u.email      AS proposer_email,
       u.first_name AS proposer_first_name,
       u.last_name  AS proposer_last_name,
       COALESCE(rv.review_count, 0) AS review_count,
       rv.average_review_score AS average_review_score,
       COALESCE(rv.accept_count, 0) AS recommendation_accept_count,
       COALESCE(rv.needs_work_count, 0) AS recommendation_needs_work_count,
       COALESCE(rv.reject_count, 0) AS recommendation_reject_count,
       pd.final_status AS decision_status,
       pd.decision_note AS decision_note,
       pd.decided_at AS decision_decided_at
     FROM session_proposals sp
     JOIN users u ON u.id = sp.proposer_user_id
     LEFT JOIN (
       SELECT
         proposal_id,
         COUNT(*) AS review_count,
         AVG(score) AS average_review_score,
         SUM(CASE WHEN recommendation = 'accept' THEN 1 ELSE 0 END) AS accept_count,
         SUM(CASE WHEN recommendation = 'needs-work' THEN 1 ELSE 0 END) AS needs_work_count,
         SUM(CASE WHEN recommendation = 'reject' THEN 1 ELSE 0 END) AS reject_count
       FROM proposal_reviews
       GROUP BY proposal_id
     ) rv ON rv.proposal_id = sp.id
     LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, limit + 1, offset],
  );

  const hasMore = rows.length > limit;
  const proposals = hasMore ? rows.slice(0, limit) : rows;
  const [totalRow, statusRows, recommendationRows, reviewedRow] = await Promise.all([
    first<{ total: number }>(
      requestDb(c),
      `SELECT COUNT(*) AS total
     FROM session_proposals sp
     JOIN users u ON u.id = sp.proposer_user_id
     WHERE ${conditions.join(" AND ")}`,
      params,
    ),
    all<{ status: string; count: number }>(
      requestDb(c),
      `SELECT status, COUNT(*) AS count
       FROM session_proposals
       WHERE event_id = ?
       GROUP BY status`,
      [event.id],
    ),
    all<{ recommendation: string; count: number }>(
      requestDb(c),
      `SELECT pr.recommendation, COUNT(*) AS count
       FROM proposal_reviews pr
       JOIN session_proposals sp ON sp.id = pr.proposal_id
       WHERE sp.event_id = ?
       GROUP BY pr.recommendation`,
      [event.id],
    ),
    first<{ reviewed_count: number }>(
      requestDb(c),
      `SELECT COUNT(DISTINCT sp.id) AS reviewed_count
       FROM session_proposals sp
       JOIN proposal_reviews pr ON pr.proposal_id = sp.id
       WHERE sp.event_id = ?`,
      [event.id],
    ),
  ]);
  const total = Number(totalRow?.total ?? 0);
  const byStatus: Record<string, number> = {};
  const byRecommendation: Record<string, number> = {};
  for (const row of statusRows) byStatus[row.status] = Number(row.count);
  for (const row of recommendationRows) byRecommendation[row.recommendation] = Number(row.count);
  const statsTotal = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  const reviewedCount = Number(reviewedRow?.reviewed_count ?? 0);

  return json({
    event: { id: event.id, slug: event.slug, name: event.name },
    permissions: access,
    access,
    proposals,
    stats: {
      byStatus,
      byRecommendation,
      reviewedCount,
      unreviewedCount: Math.max(0, statsTotal - reviewedCount),
      total: statsTotal,
    },
    pagination: {
      limit,
      offset,
      hasMore,
      total,
    },
    page: {
      limit,
      offset,
      hasMore,
      total,
    },
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestGet(c);
}

export const AdminEventsEventSlugProposalsGet = openApiRoute(
  {
    tags: ["Admin proposals"],
    summary: "List event proposals",
    request: {
      params: eventSlugParamsSchema,
      query: adminEventProposalsQuerySchema,
    },
    responses: {
      "200": { description: "Event proposals visible to the authenticated actor." },
      "401": { description: "Missing or invalid authentication." },
      "403": { description: "The actor lacks access to proposals for this event." },
    },
  },
  onRequestGet,
);
