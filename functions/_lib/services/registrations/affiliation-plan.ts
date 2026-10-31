import type { z } from "zod";
import type { identityAffiliationPrepareSchema } from "../../../../assets/shared/schemas/identity-affiliation";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import type { VerifiedAffiliationBasis } from "../identities/verified-affiliation-basis";
import { planVerifiedAffiliation } from "../identities/verified-affiliation-plan";
import { prepareRegistrationOrganizationReview } from "./organization-review";

/** A membership reservation delays affiliation, while verified attendees can still register. */
export async function planRegistrationAffiliation(
  db: DatabaseLike,
  authority: { userId: string; proofEvidence: AuthorizationEvidence },
  input: z.infer<typeof identityAffiliationPrepareSchema>,
  basis: VerifiedAffiliationBasis,
  at: string,
) {
  const pendingClaim = basis.claims.find((claim) => claim.applicationId);
  if (!pendingClaim)
    return {
      ...(await planVerifiedAffiliation(db, authority, input, basis, at)),
      outcome: "linked" as const,
      prepareReview: undefined,
    };
  if (input.organizationId !== null || !input.organizationName)
    throw new AppError(422, "ORGANIZATION_NAME_REQUIRED", "Provide the organization name for review.");
  const organizationName = input.organizationName;
  return {
    identityId: null,
    representation: { organizationName: null, jobTitle: null },
    outcome: "review_required" as const,
    statements: [
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE EXISTS (${authority.proofEvidence.sql}) AND EXISTS (
          SELECT 1 FROM organization_domain_claims WHERE id=? AND domain=? AND application_id=? AND organization_id IS NULL)`,
        bindings: [
          ...authority.proofEvidence.bindings,
          pendingClaim.id,
          pendingClaim.domain,
          pendingClaim.applicationId,
        ],
      }),
    ],
    prepareReview: (registrationId: string) =>
      prepareRegistrationOrganizationReview(db, {
        registrationId,
        userId: authority.userId,
        organization: { name: organizationName, jobTitle: input.jobTitle },
        domain: basis.domain,
        at,
      }),
  };
}
