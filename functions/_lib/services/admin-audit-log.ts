import { ADMIN_AUDIT_LOG_SORT_COLUMNS } from "../../../assets/shared/schemas/admin-audit-log";
import type { AuditLogListQuery } from "../../../assets/shared/schemas/admin-audit-log";
import type { DatabaseLike } from "../types";
import { listAuditLogPage } from "./audit-log-read";

export async function listAdminAuditLog(db: DatabaseLike, query: AuditLogListQuery) {
  const { auditLog, page } = await listAuditLogPage(
    db,
    query,
    {},
    {
      expressions: {
        actor: "actor_display",
        action: "al.action",
        entity_type: "al.entity_type",
        created_at: "al.created_at",
      } satisfies Record<(typeof ADMIN_AUDIT_LOG_SORT_COLUMNS)[number], string>,
      fallback: "al.created_at DESC",
    },
  );
  return { entries: auditLog, page };
}
