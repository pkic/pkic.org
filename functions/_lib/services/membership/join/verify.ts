import { emailDomainOf } from "../../../../../assets/shared/constants/email-domains";
import type { MemberJoinVerifyResponse } from "./types";
import { first } from "../../../db/queries";
import type { DatabaseLike } from "../../../types";
import { nowIso } from "../../../utils/time";
import { buildFindOrCreateUserStatement } from "../../users";
import { findUserEmailOwner, isEmailReservationConflict } from "../../user-emails";
import { prepareVerifyOwnedEmailStatements } from "../../email-verification";
import { prepareVerifiedDomainAssociationStatements } from "../../organization-representations";
import { prepareAuditLog } from "../../audit";
import { prepareOneTimeAuditLog } from "../../audit";
import { prepareUserSession } from "../../../auth/user-session";
import { AppError } from "../../../errors";
import { issueMemberJoinApplicationToken, verifyMemberJoinVerificationToken } from "./capabilities";

interface ClaimedMemberRow {
  member_id: string;
}

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
      memberId: string;
      sessionId: string;
      expiresAt: string;
    }
> {
  const capability = await verifyMemberJoinVerificationToken(input.signingSecret, input.token);
  const domain = emailDomainOf(capability.email);
  const owner = await findUserEmailOwner(db, capability.email);
  // A previously verified alias is an authentication identity for the same
  // canonical user. An unverified admin-added alias is only a reservation:
  // this join link must not turn a potentially mistaken association into
  // access to that user's unrelated capacities.
  if (owner?.kind === "pending" || (owner?.kind === "secondary" && owner.verified !== 1)) {
    return { status: "support_required" };
  }
  const claimedMember = await first<ClaimedMemberRow>(
    db,
    `SELECT member.id AS member_id
       FROM organization_domain_claims claim
       JOIN members member
         ON member.organization_id = claim.organization_id
        AND member.status = 'active'
      WHERE claim.domain = ? AND claim.organization_id IS NOT NULL
      LIMIT 1`,
    [domain],
  );
  if (!claimedMember) {
    if (capability.applicantKind === "individual") {
      if (owner) {
        const activeRepresentation = await first<{ id: string }>(
          db,
          `SELECT id FROM organization_representatives
            WHERE user_id = ? AND left_at IS NULL AND blocked_at IS NULL
            LIMIT 1`,
          [owner.userId],
        );
        if (activeRepresentation) return { status: "support_required" };
      }
    }
    return issueApplicationContinuation(
      input.signingSecret,
      capability,
      input.applicationTtlSeconds,
      owner?.userId ?? null,
    );
  }

  const preparedUser = await buildFindOrCreateUserStatement(db, { email: capability.email });
  const existingState = preparedUser.created
    ? null
    : await first<{ active: number }>(db, "SELECT active FROM users WHERE id = ?", [preparedUser.user.id]);
  if (existingState?.active === 0) return { status: "support_required" };

  const blocked = await first<{ id: string }>(
    db,
    `SELECT id FROM organization_representatives
      WHERE member_id = ? AND user_id = ? AND blocked_at IS NOT NULL`,
    [claimedMember.member_id, preparedUser.user.id],
  );
  if (blocked) return { status: "support_required" };

  const verifiedAt = nowIso();
  try {
    await db.batch([
      ...(preparedUser.statement ? [preparedUser.statement] : []),
      ...prepareVerifyOwnedEmailStatements(db, {
        userId: preparedUser.user.id,
        normalizedEmail: capability.email,
        method: "magic_link",
        verifiedAt,
      }),
      ...(await prepareVerifiedDomainAssociationStatements(db, {
        userId: preparedUser.user.id,
        normalizedEmail: capability.email,
        at: verifiedAt,
      })),
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
    ]);
  } catch (error) {
    if (isEmailReservationConflict(error)) return { status: "support_required" };
    throw error;
  }

  const activeRepresentative = await first<{ id: string }>(
    db,
    `SELECT id FROM organization_representatives
      WHERE member_id = ? AND user_id = ? AND left_at IS NULL AND blocked_at IS NULL`,
    [claimedMember.member_id, preparedUser.user.id],
  );
  if (!activeRepresentative) return { status: "support_required" };

  const session = await prepareUserSession(db, preparedUser.user.id, input.sessionTtlHours);
  try {
    await db.batch([
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
      session.statement,
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("uq_audit_log_idempotency_key") || error.message.includes("audit_log.idempotency_key"))
    ) {
      throw new AppError(409, "MEMBER_JOIN_LINK_USED", "Membership verification link already used");
    }
    throw error;
  }
  return {
    status: "organization_session_ready",
    userId: preparedUser.user.id,
    memberId: claimedMember.member_id,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
  };
}
