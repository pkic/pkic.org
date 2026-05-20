import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { first, all } from "../../../../../_lib/db/queries";
import type { DatabaseLike } from "../../../../../_lib/types";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

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

async function fetchAuditLog(db: DatabaseLike, proposalId: string): Promise<AuditLogRow[]> {
  return all<AuditLogRow>(
    db,
    `SELECT
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
     WHERE (al.entity_type = 'proposal' AND al.entity_id = ?)
        OR (al.entity_type = 'proposal_review' AND pr.proposal_id = ?)
        OR (al.entity_type = 'proposal_speaker' AND ps.proposal_id = ?)
     ORDER BY al.created_at DESC
     LIMIT 200`,
    [proposalId, proposalId, proposalId],
  );
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<{ id: string }>(requestDb(c), "SELECT id FROM session_proposals WHERE id = ?", [
    proposalId,
  ]);
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const entries = await fetchAuditLog(requestDb(c), proposalId);

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

  return json({ auditLog: parsed });
}
