import { EmptyState } from "../../../../../../ui/EmptyState";
import { ProposalAuditLog } from "../../../../../../components/proposals/ProposalAuditLog";
import { proposalResourcePath } from "./proposal-api";

export function AuditLogSection({ proposalId, enabled }: { proposalId: string; enabled: boolean }) {
  if (!enabled) {
    // Nothing the viewer can act on, so it is announced politely rather than
    // as an alert — `EmptyState` carries role="status" for exactly this.
    return <EmptyState title="Audit log unavailable" body="Audit log access requires proposal review permission." />;
  }
  return <ProposalAuditLog endpoint={proposalResourcePath(proposalId, "audit-log")} />;
}
