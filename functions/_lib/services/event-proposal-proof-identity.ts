import type { z } from "zod";
import type { eventProposalProofIdentityPatchSchema } from "../../../assets/shared/schemas/event-proposal-proof";
import type { AuthenticatedIdentity } from "../auth/user-session";
import { first } from "../db/queries";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { prepareEventProposalPersonOwner } from "./event-proposal-proof-owner";
import { ownedIdentityEmailEvidence } from "./identities/owned-email";
import { prepareIdentityProfileUpdateStatement } from "./identities/profile-statement";

export async function updateEventProposalOwnIdentity(
  db: DatabaseLike,
  input: {
    eventId: string;
    identityId: string;
    signingSecret: string;
    body: z.infer<typeof eventProposalProofIdentityPatchSchema>;
    actor?: Pick<AuthenticatedIdentity, "userId" | "sessionId">;
  },
) {
  const at = nowIso();
  const owner = await prepareEventProposalPersonOwner(db, { ...input, ...input.body, at });
  const identity = await first<{
    id: string;
    user_id: string;
    organization_id: string;
    email_id: string | null;
    email: string;
    job_title: string | null;
    updated_at: string;
    started_at: string | null;
    ended_at: string | null;
    blocked_at: string | null;
    verified_at: string | null;
  }>(
    db,
    `
    SELECT identity.id,identity.user_id,identity.organization_id,identity.email_id,COALESCE(address.normalized_email,user.normalized_email) AS email,
      identity.job_title,identity.updated_at,identity.started_at,identity.ended_at,identity.blocked_at,
      CASE WHEN identity.email_id IS NULL THEN user.email_verified_at ELSE address.verified_at END AS verified_at
    FROM identities identity JOIN users user ON user.id=identity.user_id AND user.active=1 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL
    LEFT JOIN user_emails address ON address.id=identity.email_id AND address.user_id=identity.user_id
    WHERE identity.id=? AND identity.user_id=? AND identity.organization_id IS NOT NULL`,
    [input.identityId, owner.userId],
  );
  if (!identity) throw new AppError(404, "IDENTITY_NOT_FOUND", "Your organization representation was not found.");
  if (!identity.started_at || identity.ended_at || identity.blocked_at)
    throw new AppError(409, "IDENTITY_INACTIVE", "Only your active representation can be edited.");
  // A mailbox continuation may establish primary verification in this same guarded batch.
  if (!identity.verified_at && owner.proofEmail !== identity.email)
    throw new AppError(422, "IDENTITY_EMAIL_UNVERIFIED", "Confirm this representation's email before editing it.");
  try {
    await db.batch([
      ...owner.guards,
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM identities identity JOIN users user ON user.id=identity.user_id WHERE identity.id=? AND identity.user_id=? AND identity.organization_id=? AND identity.email_id IS ? AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL AND identity.updated_at=? AND user.active=1 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL",
        bindings: [identity.id, owner.userId, identity.organization_id, identity.email_id, identity.updated_at],
      }),
      prepareAuthorizationGuard(
        db,
        ownedIdentityEmailEvidence({
          userId: owner.userId,
          emailId: identity.email_id,
          normalizedEmail: identity.email,
          requireVerifiedPrimary: true,
        }),
      ),
      prepareIdentityProfileUpdateStatement(db, identity, { jobTitle: input.body.jobTitle }, at),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "user", id: owner.userId },
        "user",
        owner.userId,
        "organization_identity_profile_updated",
        "identity",
        identity.id,
        { organizationId: identity.organization_id, jobTitle: { from: identity.job_title, to: input.body.jobTitle } },
        at,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error) || isAuditChangeGuardFailure(error))
      throw new AppError(409, "IDENTITY_CHANGED", "Your representation or authority changed. Reload before saving.");
    throw error;
  }
  const saved = await first<{ job_title: string | null }>(
    db,
    "SELECT job_title FROM identities WHERE id=? AND user_id=?",
    [identity.id, owner.userId],
  );
  if (!saved) throw new Error("Saved representation is unavailable");
  return { identityId: identity.id, jobTitle: saved.job_title };
}
