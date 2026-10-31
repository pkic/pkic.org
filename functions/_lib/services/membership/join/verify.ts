import { emailDomainOf } from "../../../../../assets/shared/schemas/email-domains";
import type { MemberJoinVerifyResponse } from "./types";
import type { AuthMember, DatabaseLike } from "../../../types";
import { nowIso } from "../../../utils/time";
import { buildFindOrCreateUserStatement } from "../../users";
import { isEmailReservationConflict } from "../../user-emails";
import { provedMailboxUserId } from "../../email-ownership";
import { prepareVerifyOwnedEmailStatements } from "../../email-verification";
import { prepareExplicitVerifiedDomainIdentity } from "../../identities";
import { prepareAuditLog } from "../../audit";
import { workEmailDomain } from "../../../email-domains/classification";
import { prepareOneTimeAuditLog } from "../../audit";
import { prepareUserSession } from "../../../auth/user-session";
import { AppError } from "../../../errors";
import { issueMemberJoinApplicationToken, verifyMemberJoinVerificationToken } from "./capabilities";
import { readJoinVerification } from "./verification-read";
import { prepareEligibleMemberRead } from "../../../auth/identity-capacities";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";

async function issueApplicationContinuation(
  signingSecret: string,
  payload: Awaited<ReturnType<typeof verifyMemberJoinVerificationToken>>,
  ttlSeconds: number,
  applicantUserId: string | null,
): Promise<MemberJoinVerifyResponse> {
  return {
    status: "application_ready",
    applicantEmail: payload.email,
    applicantKind: payload.applicantKind,
    joinToken: await issueMemberJoinApplicationToken(signingSecret, { ...payload, applicantUserId }, ttlSeconds),
  };
}

export async function verifyMemberJoin(
  db: DatabaseLike,
  input: { token: string; signingSecret: string; applicationTtlSeconds: number; sessionTtlHours: number },
): Promise<
  | MemberJoinVerifyResponse
  | {
      status: "organization_session_ready";
      userId: string;
      identityId: string;
      memberId: string;
      sessionId: string;
      expiresAt: string;
      member: AuthMember;
    }
> {
  const capability = await verifyMemberJoinVerificationToken(input.signingSecret, input.token);
  // A valid mailbox proof can show sign-in guidance even if a previous visit
  // already consumed the join link. It must never mint another session.
  const observed = await readJoinVerification(db, capability.email, capability.capabilityId);
  if (observed.existingMembership) return { status: "already_member" };
  if (observed.consumed) {
    throw new AppError(409, "MEMBER_JOIN_LINK_USED", "Membership verification link already used");
  }
  const domain = observed.claim?.domain ?? workEmailDomain(capability.email) ?? emailDomainOf(capability.email);
  const provedUserId = provedMailboxUserId(observed.ownership);
  const claimedMember = observed.member;
  if (!claimedMember) {
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
      member: observed.claim?.application_id ? null : { id: claimedMember.member_id },
      person: observed.person,
      address: observed.address,
      creation: observed.creation,
    },
  );
  const session = await prepareUserSession(db, preparedUser.user.id, input.sessionTtlHours);
  const projection = prepareEligibleMemberRead(db, preparedUser.user.id, identity.identityId);
  let member: AuthMember | null;
  try {
    const results = await db.batch([
      ...preparedUser.statements,
      ...prepareVerifyOwnedEmailStatements(db, {
        userId: preparedUser.user.id,
        normalizedEmail: capability.email,
        method: "magic_link",
        verifiedAt,
      }),
      ...identity.statements,
      prepareAuditLog(
        db,
        "user",
        preparedUser.user.id,
        "membership_join_email_verified",
        "member",
        claimedMember.member_id,
        { domain, applicantKind: capability.applicantKind },
        verifiedAt,
        `membership_join_email_verified:${capability.capabilityId}`,
        { type: "organization", id: claimedMember.member_id },
      ),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM identities WHERE id=? AND user_id=? AND organization_id=?
          AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
        bindings: [identity.identityId, preparedUser.user.id, claimedMember.organization_id],
      }),
      prepareOneTimeAuditLog(
        db,
        "user",
        preparedUser.user.id,
        "membership_join_link_consumed",
        "member",
        claimedMember.member_id,
        { domain },
        verifiedAt,
        `membership_join_link_consumed:${capability.capabilityId}`,
        { type: "organization", id: claimedMember.member_id },
      ),
      ...session.statements,
      ...projection.statements,
    ]);
    member = projection.decode(results.slice(-projection.statements.length));
  } catch (error) {
    if (isEmailReservationConflict(error)) return { status: "support_required" };
    if (
      error instanceof Error &&
      (error.message.includes("uq_audit_log_idempotency_key") || error.message.includes("audit_log.idempotency_key"))
    ) {
      throw new AppError(409, "MEMBER_JOIN_LINK_USED", "Membership verification link already used");
    }
    throw error;
  }
  if (!member) throw new AppError(500, "MEMBER_JOIN_SESSION_FAILED", "Member portal access could not be established");
  return {
    status: "organization_session_ready",
    member,
    userId: preparedUser.user.id,
    identityId: identity.identityId,
    memberId: claimedMember.member_id,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
  };
}
