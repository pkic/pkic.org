import type { ConsentItem } from "./schemas/registration";
import type { RequiredTerm } from "./schemas/event-read-models";

/** One active-term and required-acceptance policy for every registration embedding and the server. */
export function consentSelectionRefusal(
  terms: readonly Pick<RequiredTerm, "termKey" | "version" | "required">[],
  accepted: readonly ConsentItem[],
): { code: "CONSENT_INVALID" | "CONSENT_REQUIRED"; message: string } | null {
  const active = new Set(terms.map((term) => `${term.termKey}:${term.version}`));
  const selected = new Set(accepted.map((item) => `${item.termKey}:${item.version}`));
  for (const item of accepted) {
    if (!active.has(`${item.termKey}:${item.version}`))
      return {
        code: "CONSENT_INVALID",
        message: `Consent for ${item.termKey} v${item.version} is not an active event term`,
      };
  }
  for (const term of terms) {
    if (term.required && !selected.has(`${term.termKey}:${term.version}`))
      return {
        code: "CONSENT_REQUIRED",
        message: `Missing required consent for ${term.termKey} v${term.version}`,
      };
  }
  return null;
}
