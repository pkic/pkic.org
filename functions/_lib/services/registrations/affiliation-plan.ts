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
  try {
    return {
      ...(await planVerifiedAffiliation(db, authority, input, basis, at)),
      outcome: "linked" as const,
      prepareReview: undefined,
    };
  } catch (error) {
    const organizationName =
      input.organizationName ??
      basis.organizations.find((organization) => organization.id === input.organizationId)?.name;
    if (!(error instanceof AppError) || error.code !== "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED" || !organizationName)
      throw error;
    return {
      identityId: null,
      representation: { organizationName: null, jobTitle: null },
      outcome: "review_required" as const,
      statements: [prepareAuthorizationGuard(db, authority.proofEvidence)],
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
}
