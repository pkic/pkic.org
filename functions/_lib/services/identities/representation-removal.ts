import { primaryIdentityIdSql } from "./affiliation-projection";
import { proposalSpeakerIdentityIdSql } from "../proposal-speaker-profile-projection";
/** Remove an incorrect association, optionally preserving event work under a valid replacement. */
import { prepareRepresentationAuthority } from "./representation-authority";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { ownedIdentityAtEvidence } from "./selection";
import { prepareBadgeRenderJobsForUser } from "../badge-render-job-statements";
import { prepareOrganizationIdentityPublication } from "./lifecycle-publication";

export function prepareIncorrectRepresentationRemoval(
  db: DatabaseLike,
  input: {
    identityId: string;
    actorId: string;
    ownerId: string;
    at: string;
    correction?: { replacementIdentityId: string; reason: string };
  },
): StatementLike[] {
  const { identityId, actorId, ownerId, at, correction } = input;
  const replacement = correction?.replacementIdentityId;
  const registrationIdentity = `COALESCE(registration.registration_identity_id, ${primaryIdentityIdSql("registration.user_id")})`;
  const speakerIdentity = proposalSpeakerIdentityIdSql("speaker");
  return [
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM identities WHERE id=? AND blocked_at IS NULL AND user_id=?",
      bindings: [identityId, ownerId],
    }),
    ...(replacement
      ? [
          prepareAuthorizationGuard(db, ownedIdentityAtEvidence({ userId: ownerId, identityId: replacement, at })),
          prepareAuthorizationGuard(db, {
            sql: `SELECT 1 FROM identities source JOIN identities target ON target.user_id=source.user_id
          LEFT JOIN organizations organization ON organization.id=target.organization_id
        WHERE source.id=? AND target.id=? AND source.id<>target.id
          AND source.organization_id IS NOT target.organization_id
          AND (target.organization_id IS NULL OR (organization.id IS NOT NULL AND organization.merged_into_organization_id IS NULL))
          AND target.started_at IS NOT NULL
          AND target.ended_at IS NULL AND target.blocked_at IS NULL
          AND (target.organization_id IS NULL OR TRIM(COALESCE(target.job_title,''))<>'' OR NOT EXISTS(SELECT 1 FROM proposal_speakers speaker WHERE speaker.user_id=source.user_id AND (${speakerIdentity})=source.id))`,
            bindings: [identityId, replacement],
          }),
        ]
      : []),
    prepareOrganizationIdentityPublication(db, identityId, at),
    ...(replacement
      ? [
          db
            .prepare(`UPDATE registrations AS registration SET registration_identity_id=?,updated_at=?
        WHERE (${registrationIdentity})=? AND registration.user_id=?`)
            .bind(replacement, at, identityId, ownerId),
          db
            .prepare(`UPDATE proposal_speakers AS speaker SET acting_identity_id=(SELECT CASE WHEN organization_id IS NULL THEN NULL ELSE id END FROM identities WHERE id=?),acting_identity_selected_at=?
        WHERE (${speakerIdentity})=? AND speaker.user_id=?`)
            .bind(replacement, at, identityId, ownerId),
          prepareOrganizationIdentityPublication(db, replacement, at),
        ]
      : []),
    db.prepare("DELETE FROM organization_link_notices WHERE identity_id=? AND user_id=?").bind(identityId, ownerId),
    db.prepare("DELETE FROM affiliation_reviews WHERE resolved_identity_id=? AND user_id=?").bind(identityId, ownerId),
    // Incorrect organization grants are removed, never carried into the replacement organization.
    db.prepare("DELETE FROM user_roles WHERE identity_id=? AND user_id=?").bind(identityId, ownerId),
    db.prepare("DELETE FROM group_memberships WHERE identity_id=? AND user_id=?").bind(identityId, ownerId),
    // Voting, membership, and successor references deliberately restrict deletion and roll back the whole correction.
    db
      .prepare(`DELETE FROM identities WHERE id=?
      AND NOT EXISTS(SELECT 1 FROM registrations registration WHERE registration.user_id=? AND (${registrationIdentity})=?)
      AND NOT EXISTS(SELECT 1 FROM proposal_speakers speaker WHERE speaker.user_id=? AND (${speakerIdentity})=?)`)
      .bind(identityId, ownerId, identityId, ownerId, identityId),
    prepareAuditLogAfterOneChange(
      db,
      "user",
      actorId,
      correction ? "incorrect_representation_corrected" : "incorrect_representation_removed",
      "identity",
      identityId,
      correction ?? {},
      at,
    ),
    ...(correction
      ? [
          ...prepareAutomaticGroupEnrollmentForUserStatements(db, ownerId, at),
          prepareBadgeRenderJobsForUser(db, ownerId, at),
        ]
      : []),
  ];
}

export function incorrectRepresentationRemovalError(cause: unknown, correcting = false): never {
  if (isAuthorizationGuardFailure(cause))
    throw new AppError(
      409,
      "IDENTITY_REMOVAL_NOT_ALLOWED",
      "This representation cannot be changed. Refresh your profile and try again.",
    );
  if (isAuditChangeGuardFailure(cause))
    throw new AppError(
      409,
      "IDENTITY_HAS_PARTICIPATION",
      correcting
        ? "Linked participation could not be reassigned. Review these records before correcting the identity."
        : "Choose the correct representation to keep the linked registrations and speaker records.",
    );
  if (cause instanceof Error && /FOREIGN KEY constraint failed|SQLITE_CONSTRAINT_FOREIGNKEY/u.test(cause.message))
    throw new AppError(
      409,
      "IDENTITY_HAS_PROTECTED_HISTORY",
      "This identity has voting, membership, or succession records that require review before correction.",
    );
  throw cause;
}

export async function removeRepresentation(
  db: DatabaseLike,
  request: Request,
  env: Parameters<typeof prepareRepresentationAuthority>[2],
  userId: string,
  identityId: string,
) {
  const actor = await prepareRepresentationAuthority(db, request, env, userId, [
    { permission: "membership:write" },
    { permission: "identities:activate" },
  ]);
  try {
    const results = await db.batch([
      ...actor.statements,
      ...actor.evidence.map((evidence) => prepareAuthorizationGuard(db, evidence)),
      ...prepareIncorrectRepresentationRemoval(db, {
        identityId,
        actorId: actor.actorId,
        ownerId: userId,
        at: nowIso(),
      }),
    ]);
    await actor.decode(results.slice(0, actor.statements.length));
  } catch (cause) {
    incorrectRepresentationRemovalError(cause);
  }
  return { success: true as const };
}
