import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { first } from "../../../../../_lib/db/queries";
import { queryPage } from "../../../../../_lib/db/pagination";
import { buildD1TextSearchFilter } from "../../../../../_lib/db/search";
import { resolveMappedOrderBy } from "../../../../../_lib/db/sort";
import { toAuditLogResponseRows, type AuditLogReadRow } from "../../../../../_lib/services/audit";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { adminProposalAuditLogRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import type { ValidatedData } from "chanfana";

const AUDIT_LOG_WHERE = `((al.entity_type = 'proposal' AND al.entity_id = ?)
        OR (al.entity_type = 'proposal_review' AND pr.proposal_id = ?)
        OR (al.entity_type = 'proposal_speaker' AND ps.proposal_id = ?))`;

export async function onRequestGet(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalAuditLogRouteSchema>,
): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<{ id: string }>(requestDb(c), "SELECT id FROM session_proposals WHERE id = ?", [
    proposalId,
  ]);
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const limit = data.query.limit ?? 50;
  const offset = data.query.offset ?? 0;
  const search = data.query.q
    ? buildD1TextSearchFilter(data.query.q, ["al.action", "al.actor_type", "u.email", "u.first_name", "u.last_name"])
    : null;
  const searchSql = search ? `AND ${search.sql}` : "";
  const bindings = [proposalId, proposalId, proposalId, ...(search?.bindings ?? [])];
  const orderBy = resolveMappedOrderBy(
    data.query.sort,
    {
      createdAt: "al.created_at",
      action: "al.action COLLATE NOCASE",
      actor: "actor_display COLLATE NOCASE",
    },
    "al.created_at DESC",
    "al.id ASC",
  );
  const { rows: entries, total } = await queryPage<AuditLogReadRow>(
    requestDb(c),
    {
      sql: `SELECT
              al.id,
              al.actor_type,
              al.actor_id,
              COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS actor_display,
              al.action,
              al.entity_type,
              al.entity_id,
              al.details_json,
              al.created_at
            FROM audit_log al
            LEFT JOIN users u ON al.actor_type = 'admin' AND u.id = al.actor_id
            LEFT JOIN proposal_reviews pr ON al.entity_type = 'proposal_review' AND pr.id = al.entity_id
            LEFT JOIN proposal_speakers ps ON al.entity_type = 'proposal_speaker' AND ps.id = al.entity_id
            WHERE ${AUDIT_LOG_WHERE}
            ${searchSql}
            ${orderBy}
            LIMIT ? OFFSET ?`,
      bindings: [...bindings, limit, offset],
    },
    {
      sql: `SELECT COUNT(*) AS total
            FROM audit_log al
            LEFT JOIN proposal_reviews pr ON al.entity_type = 'proposal_review' AND pr.id = al.entity_id
            LEFT JOIN proposal_speakers ps ON al.entity_type = 'proposal_speaker' AND ps.id = al.entity_id
            LEFT JOIN users u ON al.actor_type = 'admin' AND u.id = al.actor_id
            WHERE ${AUDIT_LOG_WHERE}
            ${searchSql}`,
      bindings,
    },
  );
  const parsed = toAuditLogResponseRows(entries);

  return json({ auditLog: parsed, page: buildPageInfo(limit, offset, total, parsed.length) });
}
