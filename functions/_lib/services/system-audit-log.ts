import { SYSTEM_AUDIT_LOG_SORT_COLUMNS } from "../../../assets/shared/schemas/system-audit-log";
import type { SystemAuditLogListQuery } from "../../../assets/shared/schemas/system-audit-log";
import type { DatabaseLike } from "../types";
import { buildAuditLogPageQuery, listAuditLogPage } from "./audit-log-read";

const SYSTEM_AUDIT_SORT_POLICY = {
  expressions: {
    actor: "actor_display",
    action: "al.action",
    entity_type: "al.entity_type",
    created_at: "al.created_at",
  } satisfies Record<(typeof SYSTEM_AUDIT_LOG_SORT_COLUMNS)[number], string>,
  fallback: "al.created_at DESC",
};

/** Production global-audit query builder exposed for D1 query-plan assertions. */
export function buildSystemAuditLogPageQuery(query: SystemAuditLogListQuery) {
  return buildAuditLogPageQuery(query, {}, SYSTEM_AUDIT_SORT_POLICY);
}

export async function listSystemAuditLog(db: DatabaseLike, query: SystemAuditLogListQuery) {
  const { auditLog, page } = await listAuditLogPage(db, query, {}, SYSTEM_AUDIT_SORT_POLICY);
  return { entries: auditLog, page };
}
