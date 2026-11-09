import type { ConsentItem } from "./schemas/registration";
import type { RequiredTerm } from "./schemas/event-read-models";

export function isTermAccepted(term: ConsentItem, accepted: readonly ConsentItem[]): boolean {
  return accepted.some((item) => item.termKey === term.termKey && item.version === term.version);
}

/** Optional choices remain available without making an otherwise complete agreement need attention. */
export function splitTermsByAcceptance(terms: readonly RequiredTerm[], consents: readonly ConsentItem[]) {
  const accepted = terms.filter((term) => isTermAccepted(term, consents));
  const unaccepted = terms.filter((term) => !isTermAccepted(term, consents));
  return { accepted, unaccepted, missingRequired: unaccepted.filter((term) => term.required) };
}

/** One active-term and required-acceptance policy for every registration embedding and the server. */
export function consentSelectionRefusal(
  terms: readonly Pick<RequiredTerm, "termKey" | "version" | "required">[],
  accepted: readonly ConsentItem[],
): { code: "CONSENT_INVALID" | "CONSENT_REQUIRED"; message: string } | null {
  return consentSelectionIssues(terms, accepted)[0] ?? null;
}

export function consentSelectionIssues(
  terms: readonly Pick<RequiredTerm, "termKey" | "version" | "required">[],
  accepted: readonly ConsentItem[],
): Array<{ code: "CONSENT_INVALID" | "CONSENT_REQUIRED"; termKey: string; message: string }> {
  const issues: Array<{ code: "CONSENT_INVALID" | "CONSENT_REQUIRED"; termKey: string; message: string }> = [];
  const active = new Set(terms.map((term) => `${term.termKey}:${term.version}`));
  const selected = new Set(accepted.map((item) => `${item.termKey}:${item.version}`));
  for (const item of accepted) {
    if (!active.has(`${item.termKey}:${item.version}`))
      issues.push({
        code: "CONSENT_INVALID",
        termKey: item.termKey,
        message: "This agreement has changed. Review it and agree again.",
      });
  }
  for (const term of terms) {
    if (term.required && !selected.has(`${term.termKey}:${term.version}`))
      issues.push({
        code: "CONSENT_REQUIRED",
        termKey: term.termKey,
        message: "Agree to this required term to continue.",
      });
  }
  return issues;
}
