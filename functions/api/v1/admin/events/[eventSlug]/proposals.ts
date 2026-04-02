import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all, first } from "../../../../../_lib/db/queries";
import type { ProposalListRecord } from "../../../../../_lib/services/proposals";

export async function onRequestGet(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const access = await getProposalAccessForEvent(c.env.DB, event.id, admin);

  const url = new URL(c.req.raw.url);
  const status = url.searchParams.get("status")?.trim() ?? "";
  const search = url.searchParams.get("search")?.trim().toLowerCase() ?? "";
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  const conditions: string[] = ["sp.event_id = ?"];
  const params: unknown[] = [event.id];

  if (status) {
    conditions.push("sp.status = ?");
    params.push(status);
  }

  if (search) {
    conditions.push("(LOWER(sp.title) LIKE ? OR LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') || ' ' || u.email) LIKE ?)");
    const pattern = `%${search}%`;
    params.push(pattern, pattern);
  }

  const rows = await all<ProposalListRecord>(
    c.env.DB,
    `SELECT
       sp.*,
       u.email      AS proposer_email,
       u.first_name AS proposer_first_name,
       u.last_name  AS proposer_last_name,
       COALESCE(rv.review_count, 0) AS review_count,
       pd.final_status AS decision_status,
       pd.decision_note AS decision_note,
       pd.decided_at AS decision_decided_at
     FROM session_proposals sp
     JOIN users u ON u.id = sp.proposer_user_id
     LEFT JOIN (
       SELECT proposal_id, COUNT(*) AS review_count
       FROM proposal_reviews
       GROUP BY proposal_id
     ) rv ON rv.proposal_id = sp.id
     LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY sp.submitted_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit + 1, offset],
  );

  const hasMore = rows.length > limit;
  const proposals = hasMore ? rows.slice(0, limit) : rows;
  const totalRow = await first<{ total: number }>(
    c.env.DB,
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
    page: {
      limit,
      offset,
      hasMore,
      total,
    },
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestGet(c);
}
