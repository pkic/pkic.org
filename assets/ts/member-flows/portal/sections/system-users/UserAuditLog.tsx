import { AuditLogTable } from "../../../../components/AuditLogTable";
import { DetailsSummary } from "../../../../components/DetailsSummary";

export function UserAuditLog({ userId }: { userId: string }) {
  return (
    <AuditLogTable
      caption="Audit log"
      endpoint={`/api/v1/users/${encodeURIComponent(userId)}/audit-log`}
      actionCell={(entry) => <span class="pk-small">{entry.action.replace(/_/g, " ")}</span>}
      detailsCell={(entry) => <DetailsSummary value={entry.details} layout="inline" />}
    />
  );
}
