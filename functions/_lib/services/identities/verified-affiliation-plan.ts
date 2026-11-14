import { prepareStateGuard } from "../../db/authorization-guard";
import { prepareOrganizationDomainClaim } from "./verified-email-domain";
import type { StatementLike } from "../../types";
import type { z } from "zod";
import { organizationDomainCandidates, workEmailDomain } from "../../email-domains/classification";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import type { identityAffiliationPrepareSchema } from "../../../../assets/shared/schemas/identity-affiliation";
import type { verifiedAffiliationBasisSchema } from "./verified-affiliation-basis";
import { prepareVerifiedOrganizationAffiliation } from "./reconciliation";
export async function planVerifiedAffiliation(
  db: DatabaseLike,
  authority: {
    userId: string;
    proofEvidence: AuthorizationEvidence;
    profile?: Parameters<typeof prepareVerifiedOrganizationAffiliation>[1]["profile"];
  },
  input: z.infer<typeof identityAffiliationPrepareSchema>,
  basis: z.infer<typeof verifiedAffiliationBasisSchema>,
  at: string,
) {
  if (!input.organizationId && !input.domain && organizationDomainCandidates(input.email).length > 1)
    throw new AppError(422, "IDENTITY_DOMAIN_REQUIRED", "Choose the email domain to link to your organization.", {
      formErrors: [],
      fieldErrors: { domain: ["Choose the email domain to link to your organization."] },
    });
  if (input.organizationId && input.organizationName !== undefined)
    throw new AppError(
      422,
      "IDENTITY_ORGANIZATION_RESOLVED",
      "Choose an existing organization or enter a new organization name.",
    );
  const selectedNewSubdomain =
    input.domain && basis.domain !== workEmailDomain(input.email) && !basis.claim ? basis.domain : null;
  if (selectedNewSubdomain && !organizationDomainCandidates(input.email).includes(selectedNewSubdomain))
    throw new AppError(
      409,
      "IDENTITY_DOMAIN_UNAVAILABLE",
      "This email domain cannot be linked. Choose another domain.",
    );
  const plan = await prepareVerifiedOrganizationAffiliation(
    db,
    {
      userId: authority.userId,
      normalizedEmail: input.email,
      emailId: input.emailId,
      organizationName: input.organizationName,
      organizationId: input.organizationId ?? undefined,
      organizationChoice: { organizationId: input.organizationId },
      profile: { ...authority.profile, jobTitle: input.jobTitle },
      at,
      proofEvidence: authority.proofEvidence,
    },
    basis,
  );
  const domainToLink = selectedNewSubdomain;
  // A chosen subdomain must still be unclaimed when the command commits.
  const unclaimedGuard = domainToLink
    ? [
        prepareStateGuard(db, {
          sql: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE domain=?)",
          bindings: [domainToLink],
        }),
      ]
    : [];
  const domainStatements: StatementLike[] = [];
  // The explicitly chosen subdomain is claimed, unless the email challenge already claimed it in this command.
  if (domainToLink) {
    domainStatements.push(
      prepareStateGuard(db, {
        sql: "SELECT 1 FROM organizations WHERE id=? AND merged_into_organization_id IS NULL",
        bindings: [plan.organizationId],
      }),
      ...prepareOrganizationDomainClaim(db, {
        domain: domainToLink,
        organizationId: plan.organizationId,
        actorUserId: authority.userId,
        now: at,
      }),
    );
  }

  return {
    ...plan,
    domainToLink,
    statements: [...unclaimedGuard, ...plan.statements, ...domainStatements],
  };
}
