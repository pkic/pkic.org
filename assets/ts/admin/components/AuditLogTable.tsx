import type { ComponentChildren } from "preact";
import { AuditLogTable as SharedAuditLogTable, type AuditLogTableProps } from "../../components/AuditLogTable";
import { loadAdminCollection } from "../services/server-collection";

/** Temporary admin adapter preserving admin-specific authentication error handling. */
export function AuditLogTable(props: AuditLogTableProps): ComponentChildren {
  return <SharedAuditLogTable {...props} load={loadAdminCollection} />;
}
