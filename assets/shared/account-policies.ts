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

/** What an event term says about itself that decides whether it is an account policy. */
export type AccountPolicyTermFacts = { termKey: string; contentRef: string | null | undefined; required: boolean };

function sitePath(ref: string): string | null {
  try {
    const url = new URL(ref, "https://pkic.org");
    if (url.origin !== "https://pkic.org") return null;
    return url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  } catch {
    return null;
  }
}

/**
 * The account policy an event term is, or null. A term is the policy only when
 * it is required, has the policy's key and links to the policy's own page: an
 * event's own wording under the same key, or an optional term, is asked as is.
 */
export function accountPolicyOfTerm(term: AccountPolicyTermFacts): AccountPolicy | null {
  if (!term.required || !term.contentRef) return null;
  const path = sitePath(term.contentRef);
  return ACCOUNT_POLICIES.find((policy) => policy.termKey === term.termKey && policy.href === path) ?? null;
}

/** The event terms a person still has to accept, given the account policies their account accepted. */
export function termsNotCoveredByAccount<Term>(
  terms: readonly Term[],
  factsOf: (term: Term) => AccountPolicyTermFacts,
  acceptedPolicies: readonly string[],
): Term[] {
  return terms.filter((term) => {
    const policy = accountPolicyOfTerm(factsOf(term));
    return !(policy && acceptedPolicies.includes(policy.termKey));
  });
}

export const ACCOUNT_POLICIES_COPY = {
  agreeBefore: "I agree to follow the ",
  agreeAfter: ".",
  noticeBefore: "By starting an account, you confirm you've read the ",
  noticeAfter: ".",
  required: "Agree to follow the Code of Conduct to start your account.",
} as const;
