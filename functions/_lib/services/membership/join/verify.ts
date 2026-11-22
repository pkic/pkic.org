import { emailDomainOf } from "../../../../../assets/shared/schemas/email-domains";
import type { MemberJoinVerifyResponse } from "./types";
import type { DatabaseLike } from "../../../types";
import { nowIso } from "../../../utils/time";
import { buildFindOrCreateUserStatement } from "../../users";
import { isEmailReservationConflict } from "../../user-emails";
import { provedMailboxUserId } from "../../email-ownership";
import { prepareExplicitVerifiedDomainIdentity } from "../../identities";
import { prepareAuditLog } from "../../audit";
import { workEmailDomain } from "../../../email-domains/classification";
import { AppError } from "../../../errors";
import {
  issueMemberJoinApplicationToken,
  newMemberJoinCapabilityPayload,
  type MemberJoinCapabilityPayload,
} from "./capabilities";
import type { MemberJoinApplicantKind } from "../../../../../assets/shared/schemas/member-join";
import { resolveOpenJoinApplication } from "./open-application";
import { readJoinVerification } from "./verification-read";
import {
  isStateGuardFailure,
  isAuthorizationGuardFailure,
  prepareAuthorizationGuard,
  prepareStateGuard,
} from "../../../db/authorization-guard";
import { resolveDomainOrganization } from "../../../../../assets/shared/organization-domain";
import { observedDomainClaimsEvidence } from "../../identities/affiliation-evidence";

/** Only an individual applies through a continuation; an organization applies as the identity that represents it. */
async function issueApplicationContinuation(
  signingSecret: string,
  payload: MemberJoinCapabilityPayload,
  ttlSeconds: number,
  applicantUserId: string,
): Promise<MemberJoinVerifyResponse> {
  return {
    status: "application_ready",
    applicantEmail: payload.email,
    applicantKind: "individual",
    joinToken: await issueMemberJoinApplicationToken(
      signingSecret,
      { email: payload.email, capabilityId: payload.capabilityId, applicantKind: "individual", applicantUserId },
      ttlSeconds,
    ),
  };
}

/**
 * Decides the membership path of a signed-in person. Their session stands for
 * the mailbox proof: the address is the account's own, and only an address the
 * account has proved continues. Nothing here starts or changes a session.
 */
export async function verifyMemberJoin(
  db: DatabaseLike,
  input: {
    userId: string;
    email: string;
    applicantKind: MemberJoinApplicantKind;
    organizationId?: string;
    continueAsIndividual?: boolean;
    signingSecret: string;
    applicationTtlSeconds: number;
  },
): Promise<MemberJoinVerifyResponse | { status: "organization_identity_ready"; identityId: string }> {
  const capability = newMemberJoinCapabilityPayload(input.email, input.applicantKind);
  const observed = await readJoinVerification(db, capability.email, input.organizationId);
  // The session's address continues only while this account is the one that proved it.
  if (provedMailboxUserId(observed.ownership) !== input.userId) return { status: "support_required" };
  if (observed.existingMembership) return { status: "already_member" };
  if (observed.openApplication.own) {
    const open = await resolveOpenJoinApplication(input.signingSecret, observed.openApplication);
    if (open?.kind === "own") return { status: "application_in_progress", statusPath: open.statusPath };
  }
  const provedUserId = input.userId;
  if (input.continueAsIndividual) {
    if (capability.applicantKind !== "individual" || input.organizationId)
      throw new AppError(422, "MEMBERSHIP_CATEGORY_TYPE_MISMATCH", "Choose an individual application path.");
    if (observed.state?.individual_conflict) return { status: "support_required" };
    return issueApplicationContinuation(input.signingSecret, capability, input.applicationTtlSeconds, provedUserId);
  }
  const facts = observed.affiliation?.basis.facts;
  const organizations = facts
    ? observed.affiliation!.basis.organizations.filter((organization) => {
        const resolution = resolveDomainOrganization(facts, { organizationId: organization.id });
        // The join links the address's own domain; a parent or subdomain organization is chosen when adding the identity.
        return (
          resolution.kind === "organization" &&
          resolution.via !== "related" &&
          (capability.applicantKind === "organization" || observed.activeMemberOrganizationIds.has(organization.id))
        );
      })
    : [];
  if (input.organizationId && !organizations.some((organization) => organization.id === input.organizationId))
    throw new AppError(409, "ORGANIZATION_AFFILIATION_CHANGED", "Choose an organization from the updated list.");
  // One open application per organization domain: a second applicant waits for it rather than adding the organization again.
  if (capability.applicantKind === "organization" && !input.organizationId && observed.openApplication.organizationOpen)
    return { status: "organization_application_in_progress" };
  if (facts && !input.organizationId && (organizations.length > 0 || capability.applicantKind === "organization")) {
    return {
      status: "organization_selection_required",
      domain: observed.affiliation!.basis.domain,
      organizations: organizations.map(({ id, name }) => ({ id, name })),
      canApplyAsIndividual: capability.applicantKind === "individual",
    };
  }
  if (
    capability.applicantKind === "organization" &&
    facts &&
    !input.organizationId &&
    resolveDomainOrganization(facts).kind === "ambiguous"
  )
    return { status: "support_required" };
  const domain =
    (input.organizationId ? observed.selectedClaimDomain : null) ??
    observed.claim?.domain ??
    workEmailDomain(capability.email) ??
    emailDomainOf(capability.email);
  const claimedMember = input.organizationId ? observed.member : null;
  if (!claimedMember) {
    // One open application per organization, whether it was chosen or resolved from the domain.
    if (observed.openApplication.organizationOpen && capability.applicantKind === "organization") {
      return { status: "organization_application_in_progress" };
    }
    // An organization that is not a member yet is applied for as the identity that represents it, added first.
    if (input.organizationId || capability.applicantKind === "organization") return { status: "support_required" };
    if (capability.applicantKind === "individual" && observed.state?.individual_conflict) {
      return { status: "support_required" };
    }
    return issueApplicationContinuation(input.signingSecret, capability, input.applicationTtlSeconds, provedUserId);
  }

  const preparedUser = await buildFindOrCreateUserStatement(
    db,
    { email: capability.email, mailboxVerified: true },
    { ownership: observed.ownership, existing: observed.person },
  );
  if (observed.state?.active === 0 || observed.blocked) return { status: "support_required" };

  const verifiedAt = nowIso();
  const identity = await prepareExplicitVerifiedDomainIdentity(
    db,
    {
      userId: preparedUser.user.id,
      organizationId: claimedMember.organization_id,
      normalizedEmail: capability.email,
      at: verifiedAt,
    },
    {
      domain,
      member: { id: claimedMember.member_id },
      person: observed.person,
      address: observed.address,
      creation: observed.creation,
    },
  );
  try {
    await db.batch([
      ...preparedUser.statements,
      ...observedDomainClaimsEvidence(capability.email, observed.affiliation?.basis.claims ?? [], {
        id: claimedMember.organization_id,
        name: organizations.find((organization) => organization.id === claimedMember.organization_id)!.name,
        domain,
      }).map((evidence) => prepareStateGuard(db, evidence)),
      ...identity.statements,
      prepareAuditLog(
        db,
        "user",
        preparedUser.user.id,
        "membership_join_representation_added",
        "member",
        claimedMember.member_id,
        { domain, applicantKind: capability.applicantKind },
        verifiedAt,
        null,
        { type: "organization", id: claimedMember.member_id },
      ),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM identities WHERE id=? AND user_id=? AND organization_id=?
          AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
        bindings: [identity.identityId, preparedUser.user.id, claimedMember.organization_id],
      }),
    ]);
  } catch (error) {
    if (isEmailReservationConflict(error)) return { status: "support_required" };
    if (isAuthorizationGuardFailure(error)) return { status: "support_required" };
    if (isStateGuardFailure(error))
      throw new AppError(409, "ORGANIZATION_AFFILIATION_CHANGED", "Choose an organization from the updated list.");
    throw error;
  }
  return { status: "organization_identity_ready", identityId: identity.identityId };
}
