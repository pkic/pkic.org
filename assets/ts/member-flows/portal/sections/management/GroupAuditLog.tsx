import { AuditLogTable } from "../../../../components/AuditLogTable";
import { DetailsSummary } from "../../../../components/DetailsSummary";
import { portalEntityHref } from "../../entity-links";

export function GroupAuditLog({ groupId }: { groupId: string }) {
  return (
    // The audit list is its own panel; wrapping it in a second one framed a
    // frame.
    <div class="pk">
      <AuditLogTable
        // The group workspace shows several tables, so this one says whose
        // history it is rather than being a fourth "Audit history".
        caption="Group history"
        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/audit-log`}
        actionCell={(entry) => <code class="pk-small">{entry.action}</code>}
        detailsCell={(entry) => <DetailsSummary value={entry.details} />}
        entityHref={portalEntityHref}
      />
    </div>
  );
}
