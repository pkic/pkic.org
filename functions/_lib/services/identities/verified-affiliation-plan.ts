import { prepareClaimDomainForOrganization } from "../membership/organization-domain-claims";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { organizationDomainCandidates } from "../../email-domains/classification";
import { prepareAuditLog } from "../audit";
import type { StatementLike } from "../../types";
import type { z } from "zod";
import { workEmailDomain } from "../../email-domains/classification";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import type { identityAffiliationPrepareSchema } from "../../../../assets/shared/schemas/identity-affiliation";
import type { verifiedAffiliationBasisSchema } from "./verified-affiliation-basis";
import { prepareVerifiedOrganizationAffiliation } from "./reconciliation";
import { verifiedRepresentationDomainCandidates } from "./verified-email-domain";
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
  if (input.organizationId && input.organizationName !== undefined)
    throw new AppError(
      422,
      "IDENTITY_ORGANIZATION_RESOLVED",
      "Choose an existing organization or enter a new organization name.",
    );
  const owned =
    input.organizationId &&
    basis.identities.some(
      (identity) =>
        identity.organization_id === input.organizationId &&
        identity.started_at &&
        identity.ended_at === null &&
        identity.blocked_at === null,
    );
  const domainToLink =
    input.domain && basis.domain !== workEmailDomain(input.email) && !basis.claim ? basis.domain : null;
  if (
    domainToLink &&
    (!verifiedRepresentationDomainCandidates(input.email, basis.claims).includes(domainToLink) ||
      basis.claims.some((claim) => claim.applicationId))
  )
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
  const domainStatements: StatementLike[] = [];
  if (domainToLink) {
    const domain = domainToLink;
    domainStatements.push(
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM organizations WHERE id=? AND merged_into_organization_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE domain=?)`,
        bindings: [plan.organizationId, domain],
      }),
      (await prepareClaimDomainForOrganization(db, { domain, organizationId: plan.organizationId, now: at }, null))!,
      prepareAuditLog(
        db,
        "user",
        authority.userId,
        "organization_domain_claimed",
        "organization",
        plan.organizationId,
        { domain: { from: null, to: domain }, reason: "Confirmed through a verified work email address" },
        at,
      ),
    );
  }

  return {
    ...plan,
    domainToLink,
    statements: [
      ...(!owned || domainToLink
        ? [
            prepareAuthorizationGuard(db, {
              sql: `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM organization_domain_claims
          WHERE domain IN (SELECT value FROM json_each(?)) AND (application_id IS NOT NULL OR length(domain)>?))`,
              bindings: [JSON.stringify(organizationDomainCandidates(input.email)), basis.domain.length],
            }),
          ]
        : []),
      ...plan.statements,
      ...domainStatements,
    ],
  };
}
