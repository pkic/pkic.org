import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import type { ScopedAuditLogListQuery } from "../../../assets/shared/schemas/audit-log";
import { first } from "../db/queries";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { toAuditLogResponseRows, type AuditLogReadRow } from "./audit";

interface AuditLogScope {
  joins: string;
  where: string;
  bindings: unknown[];
}

async function listAuditLogForScope(db: DatabaseLike, query: ScopedAuditLogListQuery, scope: AuditLogScope) {
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["al.action", "al.actor_type", "u.email", "u.first_name", "u.last_name"])
    : null;
  const searchSql = search ? `AND ${search.sql}` : "";
  const bindings = [...scope.bindings, ...(search?.bindings ?? [])];
  const orderBy = resolveMappedOrderBy(
    query.sort,
    {
      createdAt: "al.created_at",
      action: "al.action COLLATE NOCASE",
      actor: "actor_display COLLATE NOCASE",
    },
    "al.created_at DESC",
    "al.id ASC",
  );
  const from = `FROM audit_log al
    LEFT JOIN users u ON al.actor_type = 'admin' AND u.id = al.actor_id
    ${scope.joins}`;
  const { rows, total } = await queryPage<AuditLogReadRow>(db, {
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
            ${from}
            WHERE ${scope.where}
            ${searchSql}
            `,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  const auditLog = toAuditLogResponseRows(rows);
  return { auditLog, page: buildPageInfo(query.limit, query.offset, total, auditLog.length) };
}

export async function listProposalAuditLog(db: DatabaseLike, proposalId: string, query: ScopedAuditLogListQuery) {
  if (!(await first<{ id: string }>(db, "SELECT id FROM session_proposals WHERE id = ?", [proposalId]))) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  }
  return listAuditLogForScope(db, query, {
    joins: `LEFT JOIN proposal_reviews pr ON al.entity_type = 'proposal_review' AND pr.id = al.entity_id
      LEFT JOIN proposal_speakers ps ON al.entity_type = 'proposal_speaker' AND ps.id = al.entity_id`,
    where: `((al.scope_type = 'proposal' AND al.scope_id = ?)
      OR (al.scope_type IS NULL AND (
        (al.entity_type = 'proposal' AND al.entity_id = ?)
        OR (al.entity_type = 'proposal_review' AND pr.proposal_id = ?)
        OR (al.entity_type = 'proposal_speaker' AND ps.proposal_id = ?)
      )))`,
    bindings: [proposalId, proposalId, proposalId, proposalId],
  });
}

export async function listRegistrationAuditLog(
  db: DatabaseLike,
  eventId: string,
  registrationId: string,
  query: ScopedAuditLogListQuery,
) {
  const registration = await first<{ id: string }>(db, "SELECT id FROM registrations WHERE id = ? AND event_id = ?", [
    registrationId,
    eventId,
  ]);
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  return listAuditLogForScope(db, query, {
    joins: "",
    where: "al.entity_type = 'registration' AND al.entity_id = ?",
    bindings: [registrationId],
  });
}
