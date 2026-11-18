/** The account policies a person accepted when they started their account. */
import type { AccountPolicyKey } from "../../../assets/shared/account-policies";
import { uuid } from "../utils/ids";
import type { DatabaseLike, StatementLike } from "../types";

/** Records each accepted policy version once; accepting it again changes nothing. */
export function prepareAccountPolicyAcceptanceStatements(
  db: DatabaseLike,
  input: {
    userId: string;
    accepted: ReadonlyArray<{ termKey: AccountPolicyKey; version: string }>;
    at: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
  },
): StatementLike[] {
  return input.accepted.map(({ termKey, version }) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO account_policy_acceptances
           (id, user_id, term_key, term_version, accepted_at, ip_hash, user_agent_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(uuid(), input.userId, termKey, version, input.at, input.ipHash ?? null, input.userAgentHash ?? null),
  );
}
