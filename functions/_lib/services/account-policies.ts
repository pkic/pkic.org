/** The account policies a person accepted, and the event terms they therefore need not accept again. */
import {
  ACCOUNT_POLICIES,
  accountPolicyOfTerm,
  isAccountPolicyKey,
  termsNotCoveredByAccount,
  type AccountPolicyKey,
} from "../../../assets/shared/account-policies";
import { uuid } from "../utils/ids";
import { hmacSha256Hex } from "../utils/crypto";
import type { DatabaseLike, StatementLike } from "../types";
import type { EventTermRecord } from "./events";

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

/** The account policies the account accepted in their current version. */
export async function readAcceptedAccountPolicies(db: DatabaseLike, userId: string): Promise<AccountPolicyKey[]> {
  const current = JSON.stringify(ACCOUNT_POLICIES.map(({ termKey, version }) => [termKey, version]));
  const rows = await db
    .prepare(
      `SELECT acceptance.term_key AS termKey FROM account_policy_acceptances acceptance
         JOIN json_each(?) policy
           ON json_extract(policy.value, '$[0]') = acceptance.term_key
          AND json_extract(policy.value, '$[1]') = acceptance.term_version
        WHERE acceptance.user_id = ?
        ORDER BY acceptance.term_key`,
    )
    .bind(current, userId)
    .all<{ termKey: string }>();
  return rows.results.map((row) => row.termKey).filter(isAccountPolicyKey);
}

/**
 * An event term that is an account policy (`accountPolicyOfTerm`) the account
 * already accepted counts as accepted: the form does not ask for it, and the
 * event still records it. Such a term accepted on the form is recorded on the
 * account, so the next form does not ask either. Any other term, including an
 * event's own wording under a policy's key, is asked and recorded as given.
 */
export async function resolveAccountCoveredConsents(
  db: DatabaseLike,
  input: {
    userId: string;
    terms: readonly EventTermRecord[];
    accepted: ReadonlyArray<{ termKey: string; version: string }>;
    at: string;
    ip: string | null;
    userAgent: string | null;
    secret: string;
  },
): Promise<{
  consents: Array<{ termKey: string; version: string }>;
  remainingTerms: EventTermRecord[];
  statements: StatementLike[];
}> {
  const acceptedPolicies = await readAcceptedAccountPolicies(db, input.userId);
  const factsOf = (term: EventTermRecord) => ({
    termKey: term.term_key,
    contentRef: term.content_ref,
    required: Boolean(term.required),
  });
  const remainingTerms = termsNotCoveredByAccount(input.terms, factsOf, acceptedPolicies);
  const covered = input.terms
    .filter((term) => !remainingTerms.includes(term))
    .map((term) => ({ termKey: term.term_key, version: term.version }));
  // Only a term that is the account policy itself, accepted on this form, is recorded on the account.
  const newlyAccepted = input.terms.flatMap((term) => {
    const policy = accountPolicyOfTerm(factsOf(term));
    const accepted = input.accepted.some((item) => item.termKey === term.term_key && item.version === term.version);
    return policy && accepted && !acceptedPolicies.includes(policy.termKey) ? [policy] : [];
  });
  return {
    consents: [...input.accepted.filter((item) => !covered.some((c) => c.termKey === item.termKey)), ...covered],
    remainingTerms,
    statements: prepareAccountPolicyAcceptanceStatements(db, {
      userId: input.userId,
      accepted: newlyAccepted.map(({ termKey, version }) => ({ termKey, version })),
      at: input.at,
      ipHash: input.ip && newlyAccepted.length > 0 ? await hmacSha256Hex(input.secret, input.ip) : null,
      userAgentHash:
        input.userAgent && newlyAccepted.length > 0 ? await hmacSha256Hex(input.secret, input.userAgent) : null,
    }),
  };
}
