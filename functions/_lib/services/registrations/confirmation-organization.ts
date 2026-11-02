/**
 * The organization a registrant names once their address is confirmed.
 *
 * Registration confirmation already joins a verified work address to the
 * organization its domain belongs to (`linkVerifiedAddressToDomainOrganization`,
 * on the shared rule in assets/shared/organization-domain.ts). When nobody
 * owns the domain yet, the confirmation page asks for the organization once,
 * and this use case hands the stated name to the same canonical affiliation
 * rule the call for proposals uses (`prepareVerifiedOrganizationAffiliation`):
 * an organization unknown by that name is created and the domain is recorded
 * on the new identity, and anything else — an existing organization by that
 * name without the domain, a domain under review — is not linked here but
 * queued for the staff affiliation review. Free mail is never asked.
 */
import { prepareRegistrationOrganizationReview } from "./organization-review";
import { workEmailDomain } from "../../email-domains/classification";
import type {
  RegistrationConfirmOrganization,
  RegistrationOrganizationOutcome,
} from "../../../../assets/shared/schemas/registration";
import { first } from "../../db/queries";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
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

/**
 * Whether confirming this address should ask for an organization: a work
 * address whose domain resolves to no organization, for a person who holds
 * no organization yet (or nobody known by the address yet). A free-mail
 * address or a known domain asks nothing.
 */
export async function registrationAsksOrganization(
  db: DatabaseLike,
  input: { userId: string | null; normalizedEmail: string },
): Promise<boolean> {
  if (!workEmailDomain(input.normalizedEmail)) return false;
  const held = input.userId
    ? await first<{ id: string }>(
        db,
        `SELECT id FROM identities
          WHERE user_id = ? AND organization_id IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL LIMIT 1`,
        [input.userId],
      )
    : null;
  if (held) return false;
  // Only a domain nobody owns asks; an owned, held or disputed one is decided elsewhere.
  const { resolution } = await resolveEmailDomainOrganization(db, input.normalizedEmail);
  return resolution.kind === "none";
}

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
  if (
    !(await registrationAsksOrganization(db, {
      userId: confirmed.user_id,
      normalizedEmail: confirmed.normalized_email,
    }))
  )
    return null;
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
      (error instanceof AppError && REVIEW_CODES.has(error.code)) || isAuthorizationGuardFailure(error);
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
