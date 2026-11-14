import { observedOrganizationMembershipEvidence, verifiedDomainIdentityEvidence } from "./affiliation-evidence";
import { prepareIdentityProfileUpdateStatement } from "./profile-statement";
import { prepareOrganizationIdentityPublication } from "./lifecycle-publication";
import { preparePendingIdentityActivation } from "./pending-activation";
import {
  requireOrganizationLinkDomain,
  resolveVerifiedEmailDomainOrganization,
  verifiedEmailDomainResolutionEvidence,
  verifiedDomainOrganizationId,
  requireWorkOrganizationDomain,
  prepareOrganizationDomainClaim,
} from "./verified-email-domain";
export { resolveVerifiedEmailDomainOrganization } from "./verified-email-domain";
import { prepareStateGuard, prepareAuthorizationGuard, type AuthorizationEvidence } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAuditLogAfterOneChange, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { buildCreateIdentityStatement } from "../membership/identities";
import { ownedIdentityEmailEvidence, resolveOwnedIdentityEmail } from "./owned-email";
import { normalizeEmail } from "../../validation";
import { normalizeOrgName } from "../../../../assets/shared/organization-name";
import { buildResolveOrganizationStatements } from "../membership/provisioning";
import { getOrganizationDomainClaim } from "../membership/organization-domain-claims";
import { organizationIdentityAuditScope, resolveOrganizationMemberId } from "./authorization";
import type { IdentityRepresentation } from "./selection";
import { affiliationIdentityObservations, type VerifiedAffiliationBasis } from "./verified-affiliation-basis";
import { resolveDomainOrganization } from "../../../../assets/shared/organization-domain";

/**
 * Same explicit organization-join activation, prepared for a transaction that
 * records the email proof immediately before these statements.
 */
export async function prepareExplicitVerifiedDomainIdentity(
  db: DatabaseLike,
  input: { userId: string; organizationId: string; normalizedEmail: string; at: string },
  observed?: {
    domain: string;
    member: { id: string } | null;
    person: { email: string } | null;
    address: { id: string; identity_id: string | null } | null;
    creation: NonNullable<Parameters<typeof buildCreateIdentityStatement>[2]>;
  },
): Promise<{ identityId: string; statements: StatementLike[] }> {
  const domain = observed ? observed.domain : await requireOrganizationLinkDomain(db, input.normalizedEmail);
  const member = observed
    ? observed.member
    : await first<{ id: string }>(
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
  const person = observed
    ? observed.person
    : await first<{ email: string }>(db, "SELECT email FROM users WHERE id = ?", [input.userId]);
  // A new join person is inserted earlier in this same batch; exact primary proof is still rechecked at commit.
  const address = await resolveOwnedIdentityEmail(
    db,
    {
      user: { id: input.userId, email: person?.email ?? input.normalizedEmail },
      email: input.normalizedEmail,
    },
    observed?.address,
  );
  // The legacy membership-join adapter retains its active member prerequisite; affiliation itself does not.
  const authority = verifiedDomainIdentityEvidence({
    userId: input.userId,
    normalizedEmail: address.normalizedEmail,
    emailId: address.emailId,
    domain,
    organizationId: input.organizationId,
  });
  const prepared = await buildCreateIdentityStatement(
    db,
    {
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
    },
    observed?.creation,
  );
  return {
    identityId: prepared.identityId,
    statements: [
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
      prepareOrganizationIdentityPublication(db, prepared.identityId, input.at),
      ...prepared.emailOwnership,
      ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at),
    ],
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
    organizationChoice?: { organizationId: string | null };
    at: string;
    proofEvidence: AuthorizationEvidence;
    profile?: { jobTitle?: string | null; biography?: string | null; linksJson?: string | null };
  },
  observed?: VerifiedAffiliationBasis,
): Promise<{
  identityId: string;
  organizationId: string;
  memberId: string | null;
  organizationWasCreated: boolean;
  statements: StatementLike[];
  representation: IdentityRepresentation;
}> {
  if (input.organizationChoice && !observed)
    throw new AppError(409, "IDENTITY_CONTEXT_REQUIRED", "Confirm the organization details again.");
  const confirmedSelection = Boolean(input.organizationChoice);
  const normalizedEmail = normalizeEmail(input.normalizedEmail);
  const domain = observed
    ? requireWorkOrganizationDomain(observed.domain)
    : await requireOrganizationLinkDomain(db, normalizedEmail);
  const address = ownedIdentityEmailEvidence({ ...input, normalizedEmail, requireVerifiedPrimary: true });
  const proof = {
    sql: `SELECT 1 FROM users person WHERE person.id = ? AND person.active = 1
            AND EXISTS (${address.sql}) AND EXISTS (${input.proofEvidence.sql})`,
    bindings: [input.userId, ...address.bindings, ...input.proofEvidence.bindings],
  };
  const claim = observed
    ? confirmedSelection
      ? (observed.claims.find(
          (item) => item.domain === domain && item.organizationId === input.organizationChoice?.organizationId,
        ) ?? null)
      : observed.claim
    : await getOrganizationDomainClaim(db, domain, input.organizationId);
  if (
    !confirmedSelection &&
    claim?.organizationId &&
    input.organizationId &&
    claim.organizationId !== input.organizationId
  ) {
    throw new AppError(422, "IDENTITY_DOMAIN_MISMATCH", "The verified domain does not match this organization");
  }
  const named =
    (!claim?.organizationId || confirmedSelection) && !input.organizationId && input.organizationName
      ? observed
        ? (observed.organizations.find(
            (organization) => organization.normalized_name === normalizeOrgName(input.organizationName!),
          ) ?? null)
        : await first<{ id: string }>(db, "SELECT id FROM organizations WHERE normalized_name = ?", [
            normalizeOrgName(input.organizationName),
          ])
      : null;
  const selectedOrganizationId = confirmedSelection
    ? (input.organizationChoice!.organizationId ?? named?.id)
    : (claim?.organizationId ?? input.organizationId ?? named?.id);
  const owned = selectedOrganizationId
    ? observed
      ? (observed.identities.find(
          (identity) => identity.organization_id === selectedOrganizationId && identity.ended_at === null,
        ) ?? null)
      : await first<{ id: string }>(
          db,
          "SELECT id FROM identities WHERE user_id=? AND organization_id=? AND ended_at IS NULL LIMIT 1",
          [input.userId, selectedOrganizationId],
        )
    : null;
  // Resolution must not revoke an already owned relationship or rewrite its selected email/profile.
  const resolution = observed && !owned ? resolveDomainOrganization(observed.facts, input.organizationChoice) : null;
  const resolvedId = resolution ? verifiedDomainOrganizationId(domain, resolution) : null;
  // A chosen organization on a parent domain or a subdomain joins through its own claim and gains none here.
  const relatedClaim =
    resolution?.kind === "organization" && resolution.via === "related"
      ? (observed!.facts.related.find((item) => item.organizationId === resolution.organizationId) ?? null)
      : null;
  const resolved = owned
    ? null
    : observed
      ? (observed.organizations.find((organization) => organization.id === resolvedId) ?? null)
      : input.organizationId && claim?.organizationId === input.organizationId
        ? await first<{ id: string; name: string }>(db, "SELECT id,name FROM organizations WHERE id=?", [
            input.organizationId,
          ])
        : await resolveVerifiedEmailDomainOrganization(db, normalizedEmail);
  if (resolved && input.organizationId && resolved.id !== input.organizationId)
    throw new AppError(422, "IDENTITY_DOMAIN_MISMATCH", "The verified domain does not match this organization");
  // Nobody joins an existing organization unasked: the person confirms it, or adds another sharing the domain.
  // A matching name without the domain stays with the review check below.
  if (!confirmedSelection && !input.organizationId && !owned && resolved)
    throw new AppError(409, "IDENTITY_CONTEXT_REQUIRED", "Confirm the organization you represent.");
  let organizationId = resolved?.id ?? selectedOrganizationId;
  const usesVerifiedEmailEvidence = resolved !== null && (!claim || resolved.id !== claim.organizationId);
  const existing = organizationId
    ? observed
      ? (() => {
          const identity = affiliationIdentityObservations(observed, organizationId!).unresolved;
          return identity
            ? {
                ...identity,
                organization_name: observed.organizations.find((organization) => organization.id === organizationId)!
                  .name,
              }
            : null;
        })()
      : await first<{
          id: string;
          email_id: string | null;
          updated_at: string;
          started_at: string | null;
          blocked_at: string | null;
          organization_name: string;
          job_title: string | null;
        }>(
          db,
          `SELECT identity.id,identity.email_id,identity.updated_at,identity.started_at,identity.blocked_at,
                organization.name AS organization_name,identity.job_title
           FROM identities identity JOIN organizations organization ON organization.id = identity.organization_id
          WHERE identity.user_id = ? AND identity.organization_id = ? AND identity.ended_at IS NULL
          ORDER BY identity.invited_at DESC,identity.id DESC LIMIT 1`,
          [input.userId, organizationId],
        )
    : null;
  if (existing?.blocked_at) throw new AppError(409, "IDENTITY_BLOCKED", "This identity requires explicit review");
  // A pending invitation is never accepted autonomously. A person who proved
  // the mailbox and chose this organization accepts it, as its emailed link would.
  if (existing && !existing.started_at && !confirmedSelection)
    throw new AppError(409, "IDENTITY_INVITATION_PENDING", "An identity invitation is already pending");
  if (existing) {
    // An owned affiliation is reused without changing its selected email or profile.
    const accepting = !existing.started_at;
    const memberId = observed
      ? (observed.organizations.find((organization) => organization.id === organizationId)?.member_id ?? null)
      : await resolveOrganizationMemberId(db, organizationId!);
    const enrichment = observedOrganizationMembershipEvidence(organizationId!, memberId);
    const completingTitle = !existing.job_title?.trim() && Boolean(input.profile?.jobTitle?.trim());
    const title = completingTitle ? input.profile!.jobTitle! : existing.job_title;
    return {
      identityId: existing.id,
      organizationId: organizationId!,
      memberId,
      organizationWasCreated: false,
      representation: { organizationName: existing.organization_name, jobTitle: title },
      statements: [
        prepareAuthorizationGuard(db, {
          sql: `SELECT 1 WHERE EXISTS (${proof.sql}) AND EXISTS (${enrichment.sql}) AND EXISTS (
                SELECT 1 FROM identities identity WHERE identity.id = ? AND identity.user_id = ?
                  AND identity.organization_id = ? AND identity.email_id IS ? AND identity.updated_at = ?
                  AND identity.started_at IS ${accepting ? "NULL" : "NOT NULL"}
                  AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
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
        ...(completingTitle
          ? [
              prepareIdentityProfileUpdateStatement(
                db,
                { ...existing, organization_id: organizationId! },
                { jobTitle: title },
                input.at,
              ),
              prepareAuditLogAfterOneChange(
                db,
                "user",
                input.userId,
                "identity_profile_completed",
                "identity",
                existing.id,
                { jobTitle: { from: existing.job_title, to: title } },
                input.at,
              ),
              prepareOrganizationIdentityPublication(db, existing.id, input.at),
            ]
          : []),
        // The guard above pins the invitation; the title completion may already have advanced updated_at.
        ...(accepting
          ? preparePendingIdentityActivation(db, {
              identityId: existing.id,
              userId: input.userId,
              at: input.at,
              audit: [
                prepareScopedAuditLogAfterOneChange(
                  db,
                  organizationIdentityAuditScope(memberId, input.userId),
                  "user",
                  input.userId,
                  "organization_identity_invitation_accepted",
                  "identity",
                  existing.id,
                  { organizationId },
                  input.at,
                ),
              ],
            })
          : prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at)),
      ],
    };
  }
  if (
    organizationId &&
    (!claim?.organizationId || input.organizationChoice?.organizationId === null) &&
    !usesVerifiedEmailEvidence
  ) {
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
    const record = await buildResolveOrganizationStatements(
      db,
      { organizationName: input.organizationName },
      input.at,
      observed
        ? {
            existingOrganizationId:
              observed.organizations.find(
                (organization) => organization.normalized_name === normalizeOrgName(input.organizationName!),
              )?.id ?? null,
            takenSlugs: observed.takenSlugs,
          }
        : undefined,
    );
    if (!record.organizationWasCreated) {
      throw new AppError(
        409,
        "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED",
        "An existing organization requires its exact claimed domain or an owned approved affiliation",
      );
    }
    organizationId = record.organizationId;
    organizationWasCreated = true;
    const absence = verifiedEmailDomainResolutionEvidence(domain, null, false, confirmedSelection);
    statements.push(
      prepareStateGuard(db, {
        sql: `SELECT 1 WHERE EXISTS (${absence.sql})
              AND NOT EXISTS (SELECT 1 FROM organizations WHERE normalized_name = ?)
              ${confirmedSelection ? "" : "AND NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE domain = ?)"}`,
        bindings: [
          ...absence.bindings,
          normalizeOrgName(input.organizationName),
          ...(confirmedSelection ? [] : [domain]),
        ],
      }),
      ...record.statements,
    );
  }
  const blocked = observed
    ? (observed.identities.find(
        (identity) => identity.organization_id === organizationId && identity.blocked_at !== null,
      ) ?? null)
    : await first<{ id: string }>(
        db,
        "SELECT id FROM identities WHERE user_id = ? AND organization_id = ? AND blocked_at IS NOT NULL",
        [input.userId, organizationId],
      );
  if (blocked) throw new AppError(409, "IDENTITY_BLOCKED", "This identity requires an explicit reviewed successor");
  const memberId = organizationWasCreated
    ? null
    : observed
      ? (observed.organizations.find((organization) => organization.id === organizationId)?.member_id ?? null)
      : await resolveOrganizationMemberId(db, organizationId);
  const enrichment = observedOrganizationMembershipEvidence(organizationId, memberId);
  const organizationName = organizationWasCreated
    ? input.organizationName!
    : observed
      ? observed.organizations.find((organization) => organization.id === organizationId)?.name
      : (await first<{ name: string }>(db, "SELECT name FROM organizations WHERE id = ?", [organizationId]))?.name;
  if (!organizationName) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  const representation: IdentityRepresentation = { organizationName, jobTitle: input.profile?.jobTitle ?? null };
  // A proved mailbox supports this person's new affiliation, not authoritative ownership of the employer's domain.
  const resolutionEvidence: AuthorizationEvidence = relatedClaim
    ? {
        sql: "SELECT 1 FROM organization_domain_claims WHERE id=? AND domain=? AND organization_id=?",
        bindings: [relatedClaim.id, relatedClaim.domain, relatedClaim.organizationId],
      }
    : verifiedEmailDomainResolutionEvidence(
        domain,
        organizationWasCreated ? null : organizationId,
        claim?.organizationId === organizationId,
        confirmedSelection || Boolean(input.organizationId),
      );
  const isVerifiedEmail = organizationWasCreated || usesVerifiedEmailEvidence;
  // Adjacent guards keep the same atomic predicates within D1's expression-depth limit.
  statements.push(
    prepareAuthorizationGuard(db, proof),
    prepareStateGuard(db, resolutionEvidence),
    prepareAuthorizationGuard(db, enrichment),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM organizations WHERE id=? AND name=?
        AND NOT EXISTS (SELECT 1 FROM identities WHERE user_id=? AND organization_id=? AND blocked_at IS NOT NULL)
        ${isVerifiedEmail && !confirmedSelection ? "AND NOT EXISTS (SELECT 1 FROM organization_domain_claims WHERE domain=?)" : ""}`,
      bindings: [
        organizationId,
        organizationName,
        input.userId,
        organizationId,
        ...(isVerifiedEmail && !confirmedSelection ? [domain] : []),
      ],
    }),
  );
  if (!isVerifiedEmail)
    statements.push(
      prepareAuthorizationGuard(
        db,
        verifiedDomainIdentityEvidence({ ...input, normalizedEmail, domain, organizationId }),
      ),
    );
  const prepared = await buildCreateIdentityStatement(
    db,
    {
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
    },
    observed ? affiliationIdentityObservations(observed, organizationId) : undefined,
  );
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
    prepareOrganizationIdentityPublication(db, prepared.identityId, input.at),
    ...prepared.emailOwnership,
    // The email challenge claims the domain it proved for the organization the person confirmed.
    ...(isVerifiedEmail && !relatedClaim
      ? prepareOrganizationDomainClaim(db, { domain, organizationId, actorUserId: input.userId, now: input.at })
      : []),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at),
  );
  return {
    identityId: prepared.identityId,
    organizationId,
    memberId,
    organizationWasCreated,
    statements,
    representation,
  };
}
