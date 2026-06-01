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
  const search = url.searchParams.get("search")?.trim().toLowerCase() ?? "";
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  const conditions: string[] = ["sp.event_id = ?"];
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
      "(LOWER(sp.title) LIKE ? OR LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') || ' ' || u.email) LIKE ?)",
    );
    const pattern = `%${search}%`;
    params.push(pattern, pattern);
  }

  const orderBy =
    sort === "score_desc"
      ? "rv.average_review_score IS NULL ASC, rv.average_review_score DESC, sp.submitted_at DESC"
      : sort === "score_asc"
        ? "rv.average_review_score IS NULL ASC, rv.average_review_score ASC, sp.submitted_at DESC"
        : "sp.submitted_at DESC";

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
  const totalRow = await first<{ total: number }>(
    requestDb(c),
    `SELECT COUNT(*) AS total
     FROM session_proposals sp
     JOIN users u ON u.id = sp.proposer_user_id
     WHERE ${conditions.join(" AND ")}`,
    params,
  );
  const total = Number(totalRow?.total ?? 0);

  return json({
    event: { id: event.id, slug: event.slug, name: event.name },
    permissions: access,
    proposals,
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
