/**
 * A verified work address joins the organization its domain belongs to.
 *
 * Prepares writes for the command that verifies the address, or runs after
 * sign-in or registration confirmation through the existing
 * affiliation join (prepareVerifiedOrganizationAffiliation), so the same
 * proof, claim and blocking rules apply as when the person joins themselves.
 * Approved domains establish affiliation for member and non-member organizations.
 * An organization the person said is not theirs is never joined again.
 */
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { normalizeEmail } from "../../validation";
import { isAuditChangeGuardFailure, prepareAuditLog } from "../audit";
import { auditActorIdentityId } from "../audit-actor";
import { hasDismissedOrganization, prepareOwnAffiliationReviewResolution } from "./affiliation-offer";
import { isConcurrentIdentityConflict } from "./conflicts";
import { loadIdentityNotificationContext, prepareIdentityNotification } from "./notifications";
import { prepareLinkNotice } from "./organization-link-notices";
import { prepareVerifiedOrganizationAffiliation } from "./reconciliation";
import { verifiedEmailDomainResolutionEvidence, resolveEmailDomainOrganization } from "./verified-email-domain";

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

interface DomainOrganizationLinkInput {
  userId: string;
  normalizedEmail: string;
  /** A platform-initiated link is audited in the same command. */
  systemDecision?: { action: string; details: Record<string, unknown> };
  /** A claim's backfill never links a person somewhere else. */
  onlyOrganizationId?: string;
  /** Staff approves this person's reviews in one selected group using current mailbox proof. */
  reviewDecision?: { groupKey: string; staffId: string; decisionId: string };
}

/** Joins an already verified address through the canonical automatic affiliation rule. */
export async function linkVerifiedAddressToDomainOrganization(
  db: DatabaseLike,
  input: DomainOrganizationLinkInput,
): Promise<{ identityId: string; organizationId: string; resolvedReviews: number } | null> {
  const address = await ownedAddressId(db, input.userId, normalizeEmail(input.normalizedEmail));
  if (!address) return null;
  const prepared = await prepareVerifiedAddressDomainOrganizationLink(db, { ...input, ...address, at: nowIso() });
  if (!prepared) return null;
  try {
    const results = await db.batch(prepared.statements);
    return {
      identityId: prepared.identityId,
      organizationId: prepared.organizationId,
      resolvedReviews: results[prepared.reviewResolutionIndex]?.meta?.changes ?? 0,
    };
  } catch (error) {
    if (isAuthorizationGuardFailure(error) || isConcurrentIdentityConflict(error) || isAuditChangeGuardFailure(error))
      return null;
    throw error;
  }
}

/**
 * Prepares an automatic affiliation for the caller's atomic command. The selected
 * address must be verified before these statements execute; the join guards
 * recheck its ownership and proof, including when verification precedes it in the batch.
 */
export async function prepareVerifiedAddressDomainOrganizationLink(
  db: DatabaseLike,
  input: DomainOrganizationLinkInput & { emailId: string | null; at: string },
): Promise<{
  identityId: string;
  organizationId: string;
  statements: StatementLike[];
  reviewResolutionIndex: number;
} | null> {
  const normalizedEmail = normalizeEmail(input.normalizedEmail);
  // `domain` is the domain the address links through: the most specific claim covering it, else its registrable domain.
  const { domain, resolution } = await resolveEmailDomainOrganization(db, normalizedEmail);
  if (!domain || resolution.kind !== "organization") return null;
  const organizationId = resolution.organizationId;
  if (input.onlyOrganizationId && input.onlyOrganizationId !== organizationId) return null;
  const [related, dismissed] = await Promise.all([
    first<{ id: string; eligible: number }>(
      db,
      `SELECT id, started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL AS eligible FROM identities WHERE user_id = ? AND organization_id = ? ORDER BY ended_at IS NULL DESC, id LIMIT 1`,
      [input.userId, organizationId],
    ),
    hasDismissedOrganization(db, input.userId, organizationId),
  ]);
  if ((related && !related.eligible) || dismissed) return null;
  if (
    related &&
    !input.reviewDecision &&
    !(await first<{ id: string }>(
      db,
      "SELECT id FROM affiliation_reviews WHERE user_id = ? AND resolved_at IS NULL LIMIT 1",
      [input.userId],
    ))
  )
    return null;
  const at = input.at;
  try {
    const context = await loadIdentityNotificationContext(db, organizationId, input.userId, true);
    const prepared = await prepareVerifiedOrganizationAffiliation(db, {
      userId: input.userId,
      normalizedEmail,
      emailId: input.emailId,
      organizationId,
      at,
      proofEvidence: { sql: "SELECT 1 FROM users WHERE id = ? AND active = 1", bindings: [input.userId] },
    });
    const decision = input.reviewDecision;
    const reviewMatch = `group_key = ? AND user_id = ? AND resolved_at IS NULL
      AND ((email_domain = ? AND (normalized_name IS NULL OR normalized_name =
        (SELECT normalized_name FROM organizations WHERE id = ?)))
        OR normalized_name = (SELECT normalized_name FROM organizations WHERE id = ?))`;
    const reviewBindings = decision ? [decision.groupKey, input.userId, domain, organizationId, organizationId] : [];
    const reviewResolution = decision
      ? db
          .prepare(`UPDATE affiliation_reviews SET resolved_identity_id = ?, resolved_by_user_id = ?, resolved_at = ?
          WHERE ${reviewMatch}`)
          .bind(prepared.identityId, decision.staffId, at, ...reviewBindings)
      : prepareOwnAffiliationReviewResolution(db, { userId: input.userId, identityId: prepared.identityId, at });
    const statements = [
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM users WHERE id = ? AND active = 1
          AND NOT EXISTS (SELECT 1 FROM affiliation_offer_dismissals WHERE user_id = ? AND organization_id = ?)
          AND NOT EXISTS (SELECT 1 FROM identities WHERE user_id = ? AND organization_id = ?
            AND (blocked_at IS NOT NULL OR ended_at IS NOT NULL OR started_at IS NULL))`,
        bindings: [input.userId, input.userId, organizationId, input.userId, organizationId],
      }),
      prepareAuthorizationGuard(
        db,
        verifiedEmailDomainResolutionEvidence(domain, organizationId, resolution.via === "claim"),
      ),
      ...prepared.statements,
      // Audit the matching open rows before closing them in this same atomic batch.
      ...(decision
        ? [
            db
              .prepare(`INSERT INTO audit_log (id, actor_type, actor_id, actor_identity_id, action, entity_type, entity_id, details_json, created_at)
          SELECT lower(hex(randomblob(16))), 'admin', ?, ?, 'affiliation_review_resolved', 'affiliation_review', id,
            json_object('decisionId', json_object('from', NULL, 'to', ?),
              'identityId', json_object('from', NULL, 'to', ?)), ?
          FROM affiliation_reviews WHERE ${reviewMatch}`)
              .bind(
                decision.staffId,
                auditActorIdentityId("admin", decision.staffId),
                decision.decisionId,
                prepared.identityId,
                at,
                ...reviewBindings,
              ),
            reviewResolution,
          ]
        : [reviewResolution]),
      // The person is told once, in the portal and by the identity email the platform already sends.
      ...(!related
        ? [
            prepareLinkNotice(db, {
              identityId: prepared.identityId,
              userId: input.userId,
              organizationId,
              domain,
              at,
            }),
            prepareIdentityNotification(db, {
              identityId: prepared.identityId,
              userId: input.userId,
              context,
              action: "linked",
              domain,
              at,
            }),
          ]
        : []),
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
    ];
    return {
      identityId: prepared.identityId,
      organizationId,
      statements,
      reviewResolutionIndex: statements.indexOf(reviewResolution),
    };
  } catch (error) {
    // A domain-policy refusal skips automatic linking before any writes execute.
    if (error instanceof AppError && error.status < 500) return null;
    throw error;
  }
}
