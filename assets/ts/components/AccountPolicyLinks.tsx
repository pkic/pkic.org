import { ACCOUNT_POLICIES, type AccountPolicyKey } from "../../shared/account-policies";
import { ExternalLink } from "../ui/ExternalLink";

/** A link to one account policy, by its title, that opens beside the form. */
export function AccountPolicyLink({ termKey }: { termKey: AccountPolicyKey }) {
  const policy = ACCOUNT_POLICIES.find((candidate) => candidate.termKey === termKey)!;
  return (
    <ExternalLink href={policy.href} external>
      {policy.title}
    </ExternalLink>
  );
}
