import { AuditLogTable } from "../../../../components/AuditLogTable";
import { SectionHeading } from "../../../../ui/SectionHeading";
import { DetailsSummary } from "../../../../components/DetailsSummary";

export function UserAuditLog({ userId }: { userId: string }) {
  return (
    <div class="pk-stack">
      <SectionHeading level={3}>Account history</SectionHeading>
      <AuditLogTable
        caption="Account history"
        endpoint={`/api/v1/users/${encodeURIComponent(userId)}/audit-log`}
        actionCell={(entry) => <span class="pk-small">{entry.action.replace(/_/g, " ")}</span>}
        detailsCell={(entry) => <DetailsSummary value={entry.details} layout="inline" />}
      />
    </div>
  );
}
