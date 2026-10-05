import {
  requireOrganizationEmailDomain,
  resolveVerifiedEmailDomainOrganization,
  verifiedEmailDomainResolutionEvidence,
} from "./verified-email-domain";
export { resolveVerifiedEmailDomainOrganization } from "./verified-email-domain";
import {
  isAuthorizationGuardFailure,
  prepareAuthorizationGuard,
  type AuthorizationEvidence,
} from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { buildCreateIdentityStatement } from "../membership/identities";
import { isConcurrentIdentityConflict } from "./conflicts";
import { ownedIdentityEmailEvidence, resolveOwnedIdentityEmail } from "./owned-email";
import { normalizeEmail } from "../../validation";
import { normalizeOrgName } from "../../../../assets/shared/organization-name";
import { buildResolveOrganizationStatements } from "../membership/provisioning";
import { getOrganizationDomainClaim } from "../membership/organization-domain-claims";
import { organizationIdentityAuditScope, resolveOrganizationMemberId } from "./authorization";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import {
  proposalActingIdentitySnapshotSchema,
  type ProposalActingIdentitySnapshot,
} from "../../../../assets/shared/schemas/proposal-acting-identity";

interface VerifiedAddress {
  normalized_email: string;
}

function verifiedDomainIdentityEvidence(input: {
  userId: string;
  normalizedEmail: string;
  emailId: string | null;
  domain: string;
  organizationId: string;
  sessionId?: string;
}): AuthorizationEvidence {
  const address = ownedIdentityEmailEvidence({ ...input, requireVerifiedPrimary: true });
  return {
    sql: `SELECT 1
            FROM organization_domain_claims claim
            JOIN organizations organization ON organization.id = claim.organization_id
           WHERE claim.domain = ?
             AND claim.organization_id = ?
             AND claim.application_id IS NULL
             AND EXISTS (${address.sql})
             AND EXISTS (SELECT 1 FROM users person WHERE person.id = ? AND person.active = 1)
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
      ...address.bindings,
      input.userId,
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
  const prepared = await prepareVerifiedOrganizationAffiliation(db, {
    ...input,
    normalizedEmail: address.normalized_email,
    at: nowIso(),
    proofEvidence: {
      sql: `SELECT 1 FROM sessions session
              JOIN users person ON person.id = session.user_id AND person.active = 1
             WHERE session.id = ? AND session.user_id = ? AND session.revoked_at IS NULL
               AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      bindings: [input.sessionId, input.userId],
    },
  });
  try {
    await db.batch(prepared.statements);
  } catch (error) {
    if (isConcurrentIdentityConflict(error) || isAuditChangeGuardFailure(error) || isAuthorizationGuardFailure(error)) {
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
  const domain = requireOrganizationEmailDomain(input.normalizedEmail);
  const member = await first<{ id: string }>(
    db,
    `SELECT member.id
       FROM organization_domain_claims claim
       JOIN members member
         ON member.organization_id = claim.organization_id
        AND member.status = 'active'
      WHERE claim.domain = ? AND claim.organization_id = ? AND claim.application_id IS NULL`,
    [domain, input.organizationId],
  );
  if (!member)
    throw new AppError(422, "IDENTITY_DOMAIN_MISMATCH", "The verified domain does not match this organization");
  const person = await first<{ email: string }>(db, "SELECT email FROM users WHERE id = ?", [input.userId]);
  // A new join person is inserted earlier in this same batch; exact primary proof is still rechecked at commit.
  const address = await resolveOwnedIdentityEmail(db, {
    user: { id: input.userId, email: person?.email ?? input.normalizedEmail },
    email: input.normalizedEmail,
  });
  // The legacy membership-join adapter retains its active member prerequisite; affiliation itself does not.
  const authority = verifiedDomainIdentityEvidence({
    userId: input.userId,
    normalizedEmail: address.normalizedEmail,
    emailId: address.emailId,
    domain,
    organizationId: input.organizationId,
  });
  const prepared = await buildCreateIdentityStatement(db, {
    userId: input.userId,
    organizationId: input.organizationId,
    emailId: address.emailId,
    source: "verified_domain",
    startImmediately: true,
    now: input.at,
    condition: {
      sql: `SELECT 1 WHERE EXISTS (${authority.sql}) AND EXISTS (
              SELECT 1 FROM members WHERE id = ? AND organization_id = ? AND status = 'active'
            )`,
      bindings: [...authority.bindings, member.id, input.organizationId],
    },
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
      { organizationId: input.organizationId, emailId: address.emailId, domain, source: "verified_domain" },
      input.at,
    ),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at),
  ];
}

/** Freezes nullable membership enrichment for this command's audit scope, without changing affiliation eligibility. */
function observedOrganizationMembershipEvidence(
  organizationId: string,
  memberId: string | null,
): AuthorizationEvidence {
  return {
    sql: `SELECT 1 WHERE (? IS NULL AND NOT EXISTS (SELECT 1 FROM members WHERE organization_id=?))
                  OR EXISTS (SELECT 1 FROM members WHERE id=? AND organization_id=?)`,
    bindings: [memberId, organizationId, memberId, organizationId],
  };
}

/** Builds canonical affiliation writes for the caller's proof/person/proposal atomic command. */
export async function prepareVerifiedOrganizationAffiliation(
  db: DatabaseLike,
  input: {
    userId: string;
    normalizedEmail: string;
    emailId: string | null;
    organizationId?: string;
    organizationName?: string;
    at: string;
    proofEvidence: AuthorizationEvidence;
    profile?: { jobTitle?: string | null; biography?: string | null; linksJson?: string | null };
  },
): Promise<{
  identityId: string;
  organizationId: string;
  memberId: string | null;
  statements: StatementLike[];
  snapshot: ProposalActingIdentitySnapshot;
}> {
  const normalizedEmail = normalizeEmail(input.normalizedEmail);
  const domain = requireOrganizationEmailDomain(normalizedEmail);
  const address = ownedIdentityEmailEvidence({ ...input, normalizedEmail, requireVerifiedPrimary: true });
  const proof = {
    sql: `SELECT 1 FROM users person WHERE person.id = ? AND person.active = 1
            AND EXISTS (${address.sql}) AND EXISTS (${input.proofEvidence.sql})`,
    bindings: [input.userId, ...address.bindings, ...input.proofEvidence.bindings],
  };
  const claim = await getOrganizationDomainClaim(db, domain);
  if (claim?.organizationId && input.organizationId && claim.organizationId !== input.organizationId) {
    throw new AppError(422, "IDENTITY_DOMAIN_MISMATCH", "The verified domain does not match this organization");
  }
  const named =
    !claim?.organizationId && !input.organizationId && input.organizationName
      ? await first<{ id: string }>(db, "SELECT id FROM organizations WHERE normalized_name = ?", [
          normalizeOrgName(input.organizationName),
        ])
      : null;
  const selectedOrganizationId = claim?.organizationId ?? input.organizationId ?? named?.id;
  const owned = selectedOrganizationId
    ? await first<{ id: string }>(
        db,
        "SELECT id FROM identities WHERE user_id=? AND organization_id=? AND ended_at IS NULL LIMIT 1",
        [input.userId, selectedOrganizationId],
      )
    : null;
  // Resolution must not revoke an already owned relationship or rewrite its selected email/profile.
  const resolved =
    owned || claim?.applicationId ? null : await resolveVerifiedEmailDomainOrganization(db, normalizedEmail);
  if (resolved && input.organizationId && resolved.id !== input.organizationId)
    throw new AppError(422, "IDENTITY_DOMAIN_MISMATCH", "The verified domain does not match this organization");
  let organizationId = resolved?.id ?? selectedOrganizationId;
  const usesVerifiedEmailEvidence = !claim && resolved !== null;
  const existing = organizationId
    ? await first<{
        id: string;
        email_id: string | null;
        updated_at: string;
        started_at: string | null;
        blocked_at: string | null;
        organization_name: string;
        job_title: string | null;
        biography: string | null;
        links_json: string | null;
      }>(
        db,
        `SELECT identity.id,identity.email_id,identity.updated_at,identity.started_at,identity.blocked_at,
                organization.name AS organization_name,identity.job_title,identity.biography,identity.links_json
           FROM identities identity JOIN organizations organization ON organization.id = identity.organization_id
          WHERE identity.user_id = ? AND identity.organization_id = ? AND identity.ended_at IS NULL
          ORDER BY identity.invited_at DESC,identity.id DESC LIMIT 1`,
        [input.userId, organizationId],
      )
    : null;
  if (existing?.blocked_at) throw new AppError(409, "IDENTITY_BLOCKED", "This identity requires explicit review");
  if (existing && !existing.started_at)
    throw new AppError(409, "IDENTITY_INVITATION_PENDING", "An identity invitation is already pending");
  if (existing) {
    // An owned approved affiliation is reused without changing its selected email or profile snapshot.
    const memberId = await resolveOrganizationMemberId(db, organizationId!);
    const enrichment = observedOrganizationMembershipEvidence(organizationId!, memberId);
    return {
      identityId: existing.id,
      organizationId: organizationId!,
      memberId,
      snapshot: proposalActingIdentitySnapshotSchema.parse({
        organizationName: existing.organization_name,
        jobTitle: existing.job_title,
        biography: existing.biography,
        links: parseLinksJson(existing.links_json),
      }),
      statements: [
        prepareAuthorizationGuard(db, {
          sql: `SELECT 1 WHERE EXISTS (${proof.sql}) AND EXISTS (${enrichment.sql}) AND EXISTS (
                SELECT 1 FROM identities identity WHERE identity.id = ? AND identity.user_id = ?
                  AND identity.organization_id = ? AND identity.email_id IS ? AND identity.updated_at = ?
                  AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
                  AND EXISTS (SELECT 1 FROM organizations WHERE id = identity.organization_id AND name = ?)
              )`,
          bindings: [
            ...proof.bindings,
            ...enrichment.bindings,
            existing.id,
            input.userId,
            organizationId,
            existing.email_id,
            existing.updated_at,
            existing.organization_name,
          ],
        }),
        ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at),
      ],
    };
  }
  if (claim?.applicationId || (claim && !claim.organizationId)) {
    throw new AppError(
      409,
      "ORGANIZATION_DOMAIN_IN_USE",
      "This organization domain requires review before affiliation",
    );
  }
  if (organizationId && !claim?.organizationId && !usesVerifiedEmailEvidence) {
    throw new AppError(
      409,
      "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED",
      "An existing organization requires its exact claimed domain or an owned approved affiliation",
    );
  }
  const statements: StatementLike[] = [];
  let organizationWasCreated = false;
  if (!organizationId) {
    if (!input.organizationName?.trim())
      throw new AppError(422, "ORGANIZATION_NAME_REQUIRED", "Provide the organization name");
    const record = await buildResolveOrganizationStatements(db, { organizationName: input.organizationName }, input.at);
    if (!record.organizationWasCreated) {
      throw new AppError(
        409,
        "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED",
        "An existing organization requires its exact claimed domain or an owned approved affiliation",
      );
    }
    organizationId = record.organizationId;
    organizationWasCreated = true;
    const absence = verifiedEmailDomainResolutionEvidence(domain, null);
    statements.push(
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE EXISTS (${proof.sql}) AND EXISTS (${absence.sql})
              AND NOT EXISTS (SELECT 1 FROM organizations WHERE normalized_name = ?)
              AND NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE domain = ?)`,
        bindings: [...proof.bindings, ...absence.bindings, normalizeOrgName(input.organizationName), domain],
      }),
      ...record.statements,
    );
  }
  const blocked = await first<{ id: string }>(
    db,
    "SELECT id FROM identities WHERE user_id = ? AND organization_id = ? AND blocked_at IS NOT NULL",
    [input.userId, organizationId],
  );
  if (blocked) throw new AppError(409, "IDENTITY_BLOCKED", "This identity requires an explicit reviewed successor");
  const memberId = organizationWasCreated ? null : await resolveOrganizationMemberId(db, organizationId);
  const enrichment = observedOrganizationMembershipEvidence(organizationId, memberId);
  const organizationName = organizationWasCreated
    ? input.organizationName!
    : (await first<{ name: string }>(db, "SELECT name FROM organizations WHERE id = ?", [organizationId]))?.name;
  if (!organizationName) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  const snapshot = proposalActingIdentitySnapshotSchema.parse({
    organizationName,
    jobTitle: input.profile?.jobTitle ?? null,
    biography: input.profile?.biography ?? null,
    links: parseLinksJson(input.profile?.linksJson ?? null),
  });
  // A proved mailbox supports this person's new affiliation, not authoritative ownership of the employer's domain.
  const resolutionEvidence = verifiedEmailDomainResolutionEvidence(
    domain,
    organizationWasCreated ? null : organizationId,
    !!claim?.organizationId,
  );
  const isVerifiedEmail = organizationWasCreated || usesVerifiedEmailEvidence;
  // Adjacent guards keep the same atomic predicates within D1's expression-depth limit.
  statements.push(
    prepareAuthorizationGuard(db, proof),
    prepareAuthorizationGuard(db, resolutionEvidence),
    prepareAuthorizationGuard(db, enrichment),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM organizations WHERE id=? AND name=?
        AND NOT EXISTS (SELECT 1 FROM identities WHERE user_id=? AND organization_id=? AND blocked_at IS NOT NULL)
        ${isVerifiedEmail ? "AND NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE domain=?)" : ""}`,
      bindings: [organizationId, organizationName, input.userId, organizationId, ...(isVerifiedEmail ? [domain] : [])],
    }),
  );
  if (!isVerifiedEmail)
    statements.push(
      prepareAuthorizationGuard(
        db,
        verifiedDomainIdentityEvidence({ ...input, normalizedEmail, domain, organizationId }),
      ),
    );
  const prepared = await buildCreateIdentityStatement(db, {
    userId: input.userId,
    organizationId,
    emailId: input.emailId,
    verifiedEmailDomain: isVerifiedEmail ? domain : null,
    jobTitle: input.profile?.jobTitle,
    biography: input.profile?.biography,
    linksJson: input.profile?.linksJson,
    source: isVerifiedEmail ? "verified_email" : "verified_domain",
    startImmediately: true,
    now: input.at,
    condition: { sql: "SELECT 1", bindings: [] },
  });
  statements.push(
    prepared.statement,
    prepareScopedAuditLogAfterOneChange(
      db,
      organizationIdentityAuditScope(memberId, input.userId),
      "user",
      input.userId,
      "organization_identity_activated",
      "identity",
      prepared.identityId,
      {
        organizationId,
        emailId: input.emailId,
        domain,
        source: isVerifiedEmail ? "verified_email" : "verified_domain",
        organizationWasCreated,
      },
      input.at,
    ),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at),
  );
  return { identityId: prepared.identityId, organizationId, memberId, statements, snapshot };
}
