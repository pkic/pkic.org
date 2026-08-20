import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { first } from "../../../../../_lib/db/queries";
import { queryPage } from "../../../../../_lib/db/pagination";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { adminProposalAuditLogRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import type { ValidatedData } from "chanfana";

interface AuditLogRow {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_display: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details_json: string | null;
  created_at: string;
}

const AUDIT_LOG_WHERE = `(al.entity_type = 'proposal' AND al.entity_id = ?)
        OR (al.entity_type = 'proposal_review' AND pr.proposal_id = ?)
        OR (al.entity_type = 'proposal_speaker' AND ps.proposal_id = ?)`;

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
  const bindings = [proposalId, proposalId, proposalId];
  const { rows: entries, total } = await queryPage<AuditLogRow>(
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
            ORDER BY al.created_at DESC
            LIMIT ? OFFSET ?`,
      bindings: [...bindings, limit, offset],
    },
    {
      sql: `SELECT COUNT(*) AS total
            FROM audit_log al
            LEFT JOIN proposal_reviews pr ON al.entity_type = 'proposal_review' AND pr.id = al.entity_id
            LEFT JOIN proposal_speakers ps ON al.entity_type = 'proposal_speaker' AND ps.id = al.entity_id
            WHERE ${AUDIT_LOG_WHERE}`,
      bindings,
    },
  );

  const parsed = entries.map((e) => ({
    ...e,
    details: e.details_json
      ? (() => {
          try {
            return JSON.parse(e.details_json);
          } catch {
            return null;
          }
        })()
      : null,
    details_json: undefined,
  }));

  return json({ auditLog: parsed, page: buildPageInfo(limit, offset, total, parsed.length) });
}
