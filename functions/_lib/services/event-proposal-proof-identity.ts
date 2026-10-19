/**
 * A speaker's edit of an identity they hold, through the authority their
 * proposal gives them: their own speaker link, an email confirmation, or their
 * session. The identity itself is edited — the same profile rule, write and
 * audit as every other identity edit — so every proposal, email, badge and
 * agenda that shows the identity shows the change. Nothing is copied onto the
 * proposal.
 */
import type { z } from "zod";
import type { eventProposalProofIdentityPatchSchema } from "../../../assets/shared/schemas/event-proposal-proof";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import type { AuthenticatedIdentity } from "../auth/user-session";
import { first } from "../db/queries";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { prepareEventProposalPersonOwner } from "./event-proposal-proof-owner";
import { identityJobTitleSql } from "./identities/affiliation-projection";
import { ownedIdentityEmailEvidence } from "./identities/owned-email";
import { prepareIdentityProfileEdit, type EditableIdentityProfile } from "./identities/profile-statement";

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
  const identity = await first<
    EditableIdentityProfile & {
      email: string;
      started_at: string | null;
      ended_at: string | null;
      blocked_at: string | null;
      verified_at: string | null;
    }
  >(
    db,
    `
    SELECT identity.id,identity.user_id,identity.organization_id,identity.email_id,COALESCE(address.normalized_email,user.normalized_email) AS email,
      identity.job_title,identity.biography,identity.links_json,identity.show_on_organization_profile,identity.updated_at,
      title.job_title AS individual_job_title,identity.started_at,identity.ended_at,identity.blocked_at,
      CASE WHEN identity.email_id IS NULL THEN user.email_verified_at ELSE address.verified_at END AS verified_at
    FROM identities identity JOIN users user ON user.id=identity.user_id AND user.active=1 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL
    LEFT JOIN user_emails address ON address.id=identity.email_id AND address.user_id=identity.user_id
    LEFT JOIN individual_job_titles title ON title.user_id=identity.user_id
    WHERE identity.id=? AND identity.user_id=?`,
    [input.identityId, owner.userId],
  );
  if (!identity) throw new AppError(404, "IDENTITY_NOT_FOUND", "Your identity was not found.");
  if (!identity.started_at || identity.ended_at || identity.blocked_at)
    throw new AppError(409, "IDENTITY_INACTIVE", "Only your active identity can be edited.");
  // A mailbox continuation may establish primary verification in this same guarded batch.
  if (!identity.verified_at && owner.proofEmail !== identity.email)
    throw new AppError(422, "IDENTITY_EMAIL_UNVERIFIED", "Confirm this identity's email before editing it.");
  const { jobTitle, biography, links } = input.body;
  const edit = prepareIdentityProfileEdit(db, identity, { jobTitle, biography, links }, at);
  try {
    await db.batch([
      ...owner.guards,
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM identities identity JOIN users user ON user.id=identity.user_id WHERE identity.id=? AND identity.user_id=? AND identity.organization_id IS ? AND identity.email_id IS ? AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL AND identity.updated_at=? AND user.active=1 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL",
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
      ...(edit.publication ? [edit.publication] : []),
      edit.update,
      // Every record made as the identity shows the edit, so the audit keeps what it showed before.
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "user", id: owner.userId },
        "user",
        owner.userId,
        "identity_profile_updated",
        "identity",
        identity.id,
        { organizationId: identity.organization_id, ...edit.changes },
        at,
      ),
      ...(edit.individualJobTitle ? [edit.individualJobTitle] : []),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error) || isAuditChangeGuardFailure(error))
      throw new AppError(409, "IDENTITY_CHANGED", "Your identity or authority changed. Reload before saving.");
    throw error;
  }
  const saved = await first<{
    organization_id: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
  }>(
    db,
    `SELECT identity.organization_id, ${identityJobTitleSql("identity.id")} AS job_title, identity.biography, identity.links_json
       FROM identities identity WHERE identity.id=? AND identity.user_id=?`,
    [identity.id, owner.userId],
  );
  if (!saved) throw new Error("Saved identity is unavailable");
  return {
    identityId: identity.id,
    organizationId: saved.organization_id,
    jobTitle: saved.job_title,
    biography: saved.biography,
    links: parseLinksJson(saved.links_json),
  };
}
