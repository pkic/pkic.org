import { ProposalAuditLog } from "../../../../../components/proposals/ProposalAuditLog";

export function AuditLogSection({ proposalId }: { proposalId: string }) {
  return <ProposalAuditLog endpoint={`/api/v1/admin/proposals/${proposalId}/audit-log`} />;
}
