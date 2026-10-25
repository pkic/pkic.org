import type { ConsentItem } from "./schemas/registration";
import type { RequiredTerm } from "./schemas/event-read-models";

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
