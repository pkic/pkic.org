import { AuditLogTable } from "../../../../components/AuditLogTable";
import { DetailsSummary } from "../../../../components/DetailsSummary";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { portalEntityHref } from "../../entity-links";

export function GroupAuditLog({ groupId }: { groupId: string }) {
  return (
    <Panel class="pk">
      <PanelBody>
        <AuditLogTable
          // The group workspace shows several tables, so this one says whose
          // history it is rather than being a fourth "Audit history".
          caption="Group history"
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/audit-log`}
          actionCell={(entry) => <code class="pk-small">{entry.action}</code>}
          detailsCell={(entry) => <DetailsSummary value={entry.details} />}
          entityHref={portalEntityHref}
        />
      </PanelBody>
    </Panel>
  );
}
