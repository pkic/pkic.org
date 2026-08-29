import { ProposalAuditLog } from "../../../../../../components/proposals/ProposalAuditLog";
import { proposalResourcePath } from "./proposal-api";

export function AuditLogSection({ proposalId, enabled }: { proposalId: string; enabled: boolean }) {
  if (!enabled) {
    return <p class="text-muted fst-italic mb-0 p-3">Audit log access requires proposal review permission.</p>;
  }
  return <ProposalAuditLog endpoint={proposalResourcePath(proposalId, "audit-log")} />;
}
