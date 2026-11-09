/**
 * A confirmed registrant explicitly names their organization. Unclaimed work
 * domains use the canonical affiliation planner; owned, shared, or reserved
 * domains require a signed chooser selection or staff review. Confirmation
 * never affiliates a person automatically.
 */
import { prepareRegistrationOrganizationReview } from "./organization-review";
import { workEmailDomain } from "../../email-domains/classification";
import type {
  RegistrationConfirmOrganization,
  RegistrationOrganizationOutcome,
} from "../../../../assets/shared/schemas/registration";
import { first } from "../../db/queries";
import { isAuthorizationGuardFailure, isStateGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { prepareVerifiedOrganizationAffiliation } from "../identities";
import { resolveEmailDomainOrganization } from "../identities/verified-email-domain";

/** Refusals of the canonical rule that mean "a person must decide", not "the request is wrong". */
const REVIEW_CODES = new Set([
  "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED",
  "ORGANIZATION_DOMAIN_IN_USE",
  "IDENTITY_BLOCKED",
  "IDENTITY_INVITATION_PENDING",
  "IDENTITY_DOMAIN_MISMATCH",
]);

/** Runs after the confirmation committed: the confirmed registration is the mailbox proof. */
export async function linkConfirmedRegistrationOrganization(
  db: DatabaseLike,
  input: { registrationId: string; organization: RegistrationConfirmOrganization; at: string },
): Promise<RegistrationOrganizationOutcome | null> {
  const confirmed = await first<{ user_id: string; normalized_email: string; confirmed_at: string }>(
    db,
    `SELECT registration.user_id, person.normalized_email, registration.confirmed_at
       FROM registrations registration JOIN users person ON person.id = registration.user_id
      WHERE registration.id = ? AND registration.confirmed_at IS NOT NULL
        AND registration.status <> 'pending_email_confirmation' AND person.email_verified_at IS NOT NULL`,
    [input.registrationId],
  );
  if (!confirmed) return null;
  if (!workEmailDomain(confirmed.normalized_email)) return null;
  const { resolution } = await resolveEmailDomainOrganization(db, confirmed.normalized_email);
  if (resolution.kind !== "none") {
    await db.batch(
      prepareRegistrationOrganizationReview(db, {
        ...input,
        userId: confirmed.user_id,
        domain: workEmailDomain(confirmed.normalized_email),
      }),
    );
    return "review_required";
  }
  const proofEvidence = {
    sql: `SELECT 1 FROM registrations WHERE id = ? AND user_id = ? AND confirmed_at = ?
            AND status <> 'pending_email_confirmation'`,
    bindings: [input.registrationId, confirmed.user_id, confirmed.confirmed_at],
  };
  try {
    const affiliation = await prepareVerifiedOrganizationAffiliation(db, {
      userId: confirmed.user_id,
      normalizedEmail: confirmed.normalized_email,
      emailId: null,
      organizationName: input.organization.name,
      at: input.at,
      proofEvidence,
      profile: { jobTitle: input.organization.jobTitle ?? null },
    });
    await db.batch(affiliation.statements);
    return "linked";
  } catch (error) {
    const needsReview =
      (error instanceof AppError && REVIEW_CODES.has(error.code)) ||
      isAuthorizationGuardFailure(error) ||
      isStateGuardFailure(error);
    if (!needsReview) throw error;
  }
  await db.batch(
    prepareRegistrationOrganizationReview(db, {
      ...input,
      userId: confirmed.user_id,
      domain: workEmailDomain(confirmed.normalized_email),
    }),
  );
  return "review_required";
}
