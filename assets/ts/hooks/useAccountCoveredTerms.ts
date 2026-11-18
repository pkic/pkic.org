import { useEffect, useMemo, useState } from "preact/hooks";
import { isAccountPolicyKey, termsNotCoveredByAccount } from "../../shared/account-policies";
import { accountPoliciesResponseSchema } from "../../shared/schemas/account-policies";
import { getJson } from "../shared/api-client";
import type { RequiredTerm } from "../shared/types";

/** Whether any of the event's terms is one an account accepts when it is started. */
export function asksAccountPolicy(terms: readonly RequiredTerm[]): boolean {
  return terms.some((term) => isAccountPolicyKey(term.termKey));
}

/** The account policies the signed-in account accepted; none while signed out or unread. */
export async function readAcceptedAccountPolicies(): Promise<string[]> {
  try {
    return (await getJson("/api/v1/users/current/policies", accountPoliciesResponseSchema)).accepted;
  } catch {
    return [];
  }
}

/**
 * The event terms still to ask for: those the account accepted with its
 * Privacy Policy and Code of Conduct are left out, and the server counts them
 * as accepted. Until the read answers, every term is asked.
 */
export function useAccountCoveredTerms(terms: readonly RequiredTerm[]): {
  remaining: RequiredTerm[];
  covered: RequiredTerm[];
} {
  const [accepted, setAccepted] = useState<string[]>([]);
  // Read only when a term is an account policy; otherwise there is nothing to leave out.
  const asks = asksAccountPolicy(terms);
  useEffect(() => {
    if (!asks) return;
    let current = true;
    void readAcceptedAccountPolicies().then((keys) => {
      if (current) setAccepted(keys);
    });
    return () => {
      current = false;
    };
  }, [asks]);
  return useMemo(() => {
    const remaining = termsNotCoveredByAccount(terms, (term) => term.termKey, accepted);
    return { remaining, covered: terms.filter((term) => !remaining.includes(term)) };
  }, [terms, accepted]);
}
