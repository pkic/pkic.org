/**
 * A verified work address joins the organization its domain belongs to.
 *
 * Runs after the sign-in or registration confirmation that verified the
 * address has committed, as its own atomic command through the existing
 * affiliation join (prepareVerifiedOrganizationAffiliation), so the same
 * proof, claim and blocking rules apply as when the person joins themselves.
 * Only organizations the shared rule links automatically are joined here; a
 * member organization waits for the person's confirmation (the offer), and an
 * organization the person said is not theirs is never joined again.
 */
import { domainLinkMode } from "../../../../assets/shared/organization-domain";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { normalizeEmail } from "../../validation";
import { isAuditChangeGuardFailure, prepareAuditLog } from "../audit";
import { hasDismissedOrganization, prepareOwnAffiliationReviewResolution } from "./affiliation-offer";
import { isConcurrentIdentityConflict } from "./conflicts";
import { loadIdentityNotificationContext, prepareIdentityNotification } from "./notifications";
import { prepareLinkNotice } from "./organization-link-notices";
import { prepareVerifiedOrganizationAffiliation } from "./reconciliation";
import { resolveEmailDomainOrganization } from "./verified-email-domain";

/** The selected address: null for the person's primary address, else their verified alias. */
async function ownedAddressId(
  db: DatabaseLike,
  userId: string,
  normalizedEmail: string,
): Promise<{ emailId: string | null } | null> {
  const owner = await first<{ id: string | null }>(
    db,
    `SELECT NULL AS id FROM users WHERE id = ? AND normalized_email = ? AND email_verified_at IS NOT NULL
     UNION ALL
     SELECT id FROM user_emails WHERE user_id = ? AND normalized_email = ? AND verified_at IS NOT NULL
     LIMIT 1`,
    [userId, normalizedEmail, userId, normalizedEmail],
  );
  return owner ? { emailId: owner.id } : null;
}

/**
 * Joins the organization `normalizedEmail`'s domain belongs to when the
 * shared rule links it automatically. Returns the joined organization, or
 * null when nothing is joined: free mail, an unowned or disputed domain, a
 * member organization, an existing or blocked relationship, or a refusal by
 * the join's own rules.
 */
export async function linkVerifiedAddressToDomainOrganization(
  db: DatabaseLike,
  input: {
    userId: string;
    normalizedEmail: string;
    /**
     * When the platform links the person on its own initiative (a domain
     * claim reaching people who verified earlier), the decision is audited
     * as the system's in the same command as the link.
     */
    systemDecision?: { action: string; details: Record<string, unknown> };
    /** Join only this organization: a claim's backfill never links a person somewhere else. */
    onlyOrganizationId?: string;
  },
): Promise<{ identityId: string; organizationId: string } | null> {
  const normalizedEmail = normalizeEmail(input.normalizedEmail);
  // `domain` is the domain the address links through: the most specific claim covering it, else its registrable domain.
  const { domain, resolution } = await resolveEmailDomainOrganization(db, normalizedEmail);
  if (!domain || resolution.kind !== "organization" || domainLinkMode(resolution) !== "automatic") return null;
  const organizationId = resolution.organizationId;
  if (input.onlyOrganizationId && input.onlyOrganizationId !== organizationId) return null;
  const [address, related, dismissed] = await Promise.all([
    ownedAddressId(db, input.userId, normalizedEmail),
    first<{ id: string }>(db, "SELECT id FROM identities WHERE user_id = ? AND organization_id = ? LIMIT 1", [
      input.userId,
      organizationId,
    ]),
    hasDismissedOrganization(db, input.userId, organizationId),
  ]);
  if (!address || related || dismissed) return null;
  const at = nowIso();
  try {
    const context = await loadIdentityNotificationContext(db, organizationId, input.userId, true);
    const prepared = await prepareVerifiedOrganizationAffiliation(db, {
      userId: input.userId,
      normalizedEmail,
      emailId: address.emailId,
      organizationId,
      at,
      proofEvidence: { sql: "SELECT 1 FROM users WHERE id = ? AND active = 1", bindings: [input.userId] },
    });
    await db.batch([
      ...prepared.statements,
      prepareOwnAffiliationReviewResolution(db, { userId: input.userId, identityId: prepared.identityId, at }),
      // The person is told once, in the portal and by the identity email the platform already sends.
      prepareLinkNotice(db, { identityId: prepared.identityId, userId: input.userId, organizationId, domain, at }),
      prepareIdentityNotification(db, {
        identityId: prepared.identityId,
        userId: input.userId,
        context,
        action: "linked",
        domain,
        at,
      }),
      ...(input.systemDecision
        ? [
            prepareAuditLog(
              db,
              "system",
              null,
              input.systemDecision.action,
              "identity",
              prepared.identityId,
              {
                ...input.systemDecision.details,
                userId: input.userId,
                organizationId,
              },
              at,
            ),
          ]
        : []),
    ]);
    return { identityId: prepared.identityId, organizationId };
  } catch (error) {
    // The join's own rules refused, or the facts changed before commit: the verification stands without a link.
    if (
      error instanceof AppError ||
      isAuthorizationGuardFailure(error) ||
      isConcurrentIdentityConflict(error) ||
      isAuditChangeGuardFailure(error)
    )
      return null;
    throw error;
  }
}
