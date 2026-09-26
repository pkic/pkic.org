import { PROPOSAL_INACTIVE_STATUSES, isProposalInactiveStatus } from "../../../assets/shared/schemas/proposal-status";

function quoteSqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Canonical SQL list for excluding proposals whose lifecycle is closed. */
export const PROPOSAL_INACTIVE_STATUS_SQL_LIST = PROPOSAL_INACTIVE_STATUSES.map(quoteSqlText).join(", ");

export { isProposalInactiveStatus };
