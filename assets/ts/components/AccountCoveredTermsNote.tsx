import { AccountPolicyLink } from "./AccountPolicyLinks";

/** Says why the Code of Conduct and the Privacy Policy are not asked for again. */
export function AccountCoveredTermsNote() {
  return (
    <p class="pk-small pk-muted">
      You agreed to follow the <AccountPolicyLink termKey="code-of-conduct" /> and read the{" "}
      <AccountPolicyLink termKey="privacy-policy" /> when you started your account.
    </p>
  );
}
