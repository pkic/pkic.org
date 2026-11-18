import { accountPolicyOfTerm, type AccountPolicyTermFacts } from "../../shared/account-policies";
import { AccountPolicyLink } from "./AccountPolicyLinks";

/** Says which account policies are not asked for again, because the account already accepted them. */
export function AccountCoveredTermsNote({ terms }: { terms: readonly AccountPolicyTermFacts[] }) {
  const keys = new Set(terms.map((term) => accountPolicyOfTerm(term)?.termKey));
  const conduct = keys.has("code-of-conduct");
  const privacy = keys.has("privacy-policy");
  if (!conduct && !privacy) return null;
  return (
    <p class="pk-small pk-muted">
      {conduct && privacy ? (
        <>
          You've already agreed to follow the <AccountPolicyLink termKey="code-of-conduct" /> and read the{" "}
          <AccountPolicyLink termKey="privacy-policy" />.
        </>
      ) : conduct ? (
        <>
          You've already agreed to follow the <AccountPolicyLink termKey="code-of-conduct" />.
        </>
      ) : (
        <>
          You've already read the <AccountPolicyLink termKey="privacy-policy" />.
        </>
      )}
    </p>
  );
}
