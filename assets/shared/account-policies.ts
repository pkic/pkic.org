import { z } from "zod";

/**
 * The policies every account takes on when it is started: the person agrees
 * to follow the Code of Conduct with a checkbox, and is told about the Privacy
 * Policy (information, not consent). Both versions are recorded. Event
 * registrations and proposals do not ask for them again once the account has
 * the current version; the bylaws and the IPR Agreement stay with a
 * membership application, which the organization agrees to as well.
 *
 * Change `version` when the document changes in substance. Accounts that
 * accepted an older version are asked again by the next event form.
 */
export const ACCOUNT_POLICIES = [
  { termKey: "privacy-policy", version: "2024-09-17", title: "Privacy Policy", href: "/privacy/" },
  { termKey: "code-of-conduct", version: "2021-03-25", title: "Code of Conduct", href: "/code-of-conduct/" },
] as const;

export type AccountPolicy = (typeof ACCOUNT_POLICIES)[number];
export type AccountPolicyKey = AccountPolicy["termKey"];

export const accountPolicyKeySchema = z.enum(ACCOUNT_POLICIES.map((policy) => policy.termKey) as [AccountPolicyKey]);

export function isAccountPolicyKey(termKey: string): termKey is AccountPolicyKey {
  return ACCOUNT_POLICIES.some((policy) => policy.termKey === termKey);
}

/** The event terms a person still has to accept, given the account policies their account accepted. */
export function termsNotCoveredByAccount<Term>(
  terms: readonly Term[],
  termKeyOf: (term: Term) => string,
  acceptedPolicies: readonly string[],
): Term[] {
  return terms.filter((term) => {
    const key = termKeyOf(term);
    return !(isAccountPolicyKey(key) && acceptedPolicies.includes(key));
  });
}

export const ACCOUNT_POLICIES_COPY = {
  agreeBefore: "I agree to follow the ",
  agreeAfter: ".",
  noticeBefore: "By starting an account, you confirm you've read the ",
  noticeAfter: ".",
  required: "Agree to follow the Code of Conduct to start your account.",
} as const;
