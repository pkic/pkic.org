/** Applicant ownership survives membership changes; selected-organization access stays scoped. */
import type { OwnAccount } from "../../../auth/member";

export function ownApplicationFilter(account: OwnAccount) {
  return {
    sql: "(applicant_user_id = ? OR member_id = ?)",
    bindings: [account.userId, account.member?.memberId ?? null],
  };
}
