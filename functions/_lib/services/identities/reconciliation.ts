import {
  emailDomainOf,
  isDisposableEmailDomain,
  isPersonalEmailDomain,
} from "../../../../assets/shared/constants/email-domains";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { buildCreateIdentityStatement } from "../membership/identities";
import { isConcurrentIdentityConflict } from "./conflicts";

interface VerifiedAddress {
  normalized_email: string;
}

function verifiedDomainIdentityEvidence(input: {
  userId: string;
  normalizedEmail: string;
  domain: string;
  organizationId: string;
  sessionId?: string;
}): AuthorizationEvidence {
  return {
    sql: `SELECT 1
            FROM organization_domain_claims claim
            JOIN members member
              ON member.organization_id = claim.organization_id
             AND member.status = 'active'
           WHERE claim.domain = ?
             AND claim.organization_id = ?
             AND (
               EXISTS (
                 SELECT 1 FROM users
                  WHERE id = ? AND normalized_email = ? AND email_verified_at IS NOT NULL
               )
               OR EXISTS (
                 SELECT 1 FROM user_emails
                  WHERE user_id = ? AND normalized_email = ? AND verified_at IS NOT NULL
               )
             )
             AND NOT EXISTS (
               SELECT 1 FROM identities blocked
                WHERE blocked.organization_id = claim.organization_id
                  AND blocked.user_id = ?
                  AND blocked.blocked_at IS NOT NULL
             )
             AND (
               ? IS NULL
               OR EXISTS (
                 SELECT 1 FROM sessions session
                  WHERE session.id = ?
                    AND session.user_id = ?
                    AND session.revoked_at IS NULL
                    AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
               )
             )
           LIMIT 1`,
    bindings: [
      input.domain,
      input.organizationId,
      input.userId,
      input.normalizedEmail,
      input.userId,
      input.normalizedEmail,
      input.userId,
      input.sessionId ?? null,
      input.sessionId ?? null,
      input.userId,
    ],
  };
}

/**
 * Explicit current-user organization join. Merely verifying an event or
 * account email never calls this use case.
 */
export async function createCurrentUserIdentityFromDomain(
  db: DatabaseLike,
  input: { userId: string; sessionId: string; organizationId: string; emailId: string | null },
): Promise<{ identityId: string; state: "active" }> {
  const address = input.emailId
    ? await first<VerifiedAddress>(
        db,
        `SELECT normalized_email FROM user_emails
          WHERE id = ? AND user_id = ? AND verified_at IS NOT NULL`,
        [input.emailId, input.userId],
      )
    : await first<VerifiedAddress>(
        db,
        `SELECT normalized_email FROM users
          WHERE id = ? AND active = 1 AND email_verified_at IS NOT NULL`,
        [input.userId],
      );
  if (!address) throw new AppError(422, "IDENTITY_EMAIL_UNVERIFIED", "Select a verified email address");
  const domain = emailDomainOf(address.normalized_email);
  if (!domain || isPersonalEmailDomain(domain) || isDisposableEmailDomain(domain)) {
    throw new AppError(
      422,
      "IDENTITY_DOMAIN_INELIGIBLE",
      "This email domain cannot establish an organization identity",
    );
  }
  const member = await first<{ id: string }>(
    db,
    `SELECT id FROM members
      WHERE organization_id = ? AND member_type = 'organization' AND status = 'active'`,
    [input.organizationId],
  );
  if (!member) throw new AppError(404, "ORGANIZATION_MEMBERSHIP_NOT_FOUND", "Active Member organization not found");
  const at = nowIso();
  const prepared = await buildCreateIdentityStatement(db, {
    userId: input.userId,
    organizationId: input.organizationId,
    emailId: input.emailId,
    source: "verified_domain",
    startImmediately: true,
    now: at,
    condition: verifiedDomainIdentityEvidence({
      userId: input.userId,
      normalizedEmail: address.normalized_email,
      domain,
      organizationId: input.organizationId,
      sessionId: input.sessionId,
    }),
  });
  try {
    await db.batch([
      prepared.statement,
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "organization", id: member.id },
        "member",
        input.userId,
        "organization_identity_activated",
        "identity",
        prepared.identityId,
        {
          organizationId: input.organizationId,
          emailId: input.emailId,
          domain,
          source: "verified_domain",
        },
        at,
      ),
      ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, at),
    ]);
  } catch (error) {
    if (isConcurrentIdentityConflict(error) || isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_CONFLICT", "The identity or domain authorization changed concurrently");
    }
    throw error;
  }
  return { identityId: prepared.identityId, state: "active" };
}

/**
 * Same explicit organization-join activation, prepared for a transaction that
 * records the email proof immediately before these statements.
 */
export async function prepareExplicitVerifiedDomainIdentityStatements(
  db: DatabaseLike,
  input: { userId: string; organizationId: string; normalizedEmail: string; at: string },
): Promise<StatementLike[]> {
  const domain = emailDomainOf(input.normalizedEmail);
  if (!domain || isPersonalEmailDomain(domain) || isDisposableEmailDomain(domain)) {
    throw new AppError(
      422,
      "IDENTITY_DOMAIN_INELIGIBLE",
      "This email domain cannot establish an organization identity",
    );
  }
  const member = await first<{ id: string }>(
    db,
    `SELECT member.id
       FROM organization_domain_claims claim
       JOIN members member
         ON member.organization_id = claim.organization_id
        AND member.status = 'active'
      WHERE claim.domain = ? AND claim.organization_id = ?`,
    [domain, input.organizationId],
  );
  if (!member)
    throw new AppError(422, "IDENTITY_DOMAIN_MISMATCH", "The verified domain does not match this organization");
  const prepared = await buildCreateIdentityStatement(db, {
    userId: input.userId,
    organizationId: input.organizationId,
    source: "verified_domain",
    startImmediately: true,
    now: input.at,
    condition: verifiedDomainIdentityEvidence({
      userId: input.userId,
      normalizedEmail: input.normalizedEmail,
      domain,
      organizationId: input.organizationId,
    }),
  });
  return [
    prepared.statement,
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "organization", id: member.id },
      "member",
      input.userId,
      "organization_identity_activated",
      "identity",
      prepared.identityId,
      { organizationId: input.organizationId, domain, source: "verified_domain" },
      input.at,
    ),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at),
  ];
}
