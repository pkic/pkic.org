import { AuditLogTable } from "../../../../components/AuditLogTable";
import { DetailsSummary } from "../../../../components/DetailsSummary";
import { portalEntityHref } from "../../entity-links";

export function GroupAuditLog({ groupId }: { groupId: string }) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-body">
        <AuditLogTable
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/audit-log`}
          actionCell={(entry) => <code class="small">{entry.action}</code>}
          detailsCell={(entry) => <DetailsSummary value={entry.details} />}
          entityHref={portalEntityHref}
        />
      </div>
    </div>
  );
}
