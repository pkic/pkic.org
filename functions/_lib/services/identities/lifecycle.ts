import { serializeLinks } from "../../../../assets/shared/schemas/links";
import type { IdentityTransition } from "../../../../assets/shared/schemas/identity";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { buildCreateIdentityStatement } from "../membership/identities";
import { prepareOrganizationIdentityManagementGuard, requireOrganizationIdentityManagement } from "./authorization";
import { loadIdentityNotificationContext, prepareIdentityNotification } from "./notifications";
import type { IdentityManagerActor } from "./types";

interface IdentityStateRow {
  id: string;
  member_id: string;
  user_id: string;
  organization_id: string;
  email_id: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  show_on_organization_profile: number;
  started_at: string | null;
  ended_at: string | null;
  blocked_at: string | null;
  updated_at: string;
}

async function commitIdentityLifecycleBatch(db: DatabaseLike, statements: StatementLike[]): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_AUTHORIZATION_CHANGED", "Identity-management access changed while saving");
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_CHANGED", "The identity changed concurrently; reload and retry");
    }
    if (error instanceof Error && error.message.includes("IDENTITY_EMAIL_INVALID")) {
      throw new AppError(422, "IDENTITY_EMAIL_INVALID", "The selected email must be verified and owned by this user");
    }
    throw error;
  }
}

async function requireOrganizationIdentity(
  db: DatabaseLike,
  organizationId: string,
  identityId: string,
): Promise<IdentityStateRow> {
  const identity = await first<IdentityStateRow>(
    db,
    `SELECT identity.id, capacity.member_id, identity.user_id, identity.organization_id,
            identity.email_id, identity.job_title, identity.biography, identity.links_json,
            identity.show_on_organization_profile, identity.started_at, identity.ended_at,
            identity.blocked_at, identity.updated_at
       FROM identities identity
       JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
      WHERE identity.id = ? AND identity.organization_id = ?`,
    [identityId, organizationId],
  );
  if (!identity) throw new AppError(404, "IDENTITY_NOT_FOUND", "Organization identity not found");
  return identity;
}

function requireActivationPermission(actor: IdentityManagerActor): void {
  if (!actor.immediateActivationAuthorized || !actor.permissionActor || !actor.databaseUserId) {
    throw new AppError(
      403,
      "IDENTITY_IMMEDIATE_ACTIVATION_REQUIRED",
      "Immediate activation requires membership:write and identities:activate on a user-backed staff session",
    );
  }
}

export async function updateOrganizationIdentityProfile(
  db: DatabaseLike,
  actor: IdentityManagerActor,
  input: {
    organizationId: string;
    identityId: string;
    emailId?: string | null;
    jobTitle?: string | null;
    biography?: string | null;
    links?: string[];
    showOnOrganizationProfile?: boolean;
  },
): Promise<{ identityId: string; state: "pending" | "active" }> {
  const identity = await requireOrganizationIdentity(db, input.organizationId, input.identityId);
  await requireOrganizationIdentityManagement(db, {
    memberId: identity.member_id,
    actorUserId: actor.userId,
    databaseUserId: actor.databaseUserId,
    staffAuthorized: actor.staffAuthorized,
  });
  if (identity.ended_at || identity.blocked_at) {
    throw new AppError(409, "IDENTITY_INACTIVE", "An ended or blocked identity cannot be edited");
  }
  const at = nowIso();
  await commitIdentityLifecycleBatch(db, [
    prepareOrganizationIdentityManagementGuard(db, {
      memberId: identity.member_id,
      actorUserId: actor.userId,
      databaseUserId: actor.databaseUserId,
      staffAuthorized: actor.staffAuthorized,
    }),
    db
      .prepare(
        `UPDATE identities
            SET email_id = CASE WHEN ? = 1 THEN ? ELSE email_id END,
                job_title = CASE WHEN ? = 1 THEN ? ELSE job_title END,
                biography = CASE WHEN ? = 1 THEN ? ELSE biography END,
                links_json = CASE WHEN ? = 1 THEN ? ELSE links_json END,
                show_on_organization_profile = CASE WHEN ? = 1 THEN ? ELSE show_on_organization_profile END,
                updated_at = ?
          WHERE id = ? AND ended_at IS NULL AND blocked_at IS NULL AND updated_at = ?`,
      )
      .bind(
        input.emailId !== undefined ? 1 : 0,
        input.emailId ?? null,
        input.jobTitle !== undefined ? 1 : 0,
        input.jobTitle ?? null,
        input.biography !== undefined ? 1 : 0,
        input.biography ?? null,
        input.links !== undefined ? 1 : 0,
        input.links === undefined ? null : serializeLinks(input.links),
        input.showOnOrganizationProfile !== undefined ? 1 : 0,
        input.showOnOrganizationProfile ? 1 : 0,
        at,
        identity.id,
        identity.updated_at,
      ),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "organization", id: identity.member_id },
      actor.actorType,
      actor.userId,
      "organization_identity_profile_updated",
      "identity",
      identity.id,
      {
        organizationId: input.organizationId,
        fields: Object.keys(input)
          .filter((field) => !["organizationId", "identityId"].includes(field))
          .sort(),
      },
      at,
    ),
  ]);
  return { identityId: identity.id, state: identity.started_at ? "active" : "pending" };
}

export async function transitionOrganizationIdentity(
  db: DatabaseLike,
  actor: IdentityManagerActor,
  input: { organizationId: string; identityId: string; transition: IdentityTransition },
): Promise<{ identityId: string; state: "active" | "ended" | "blocked" }> {
  const identity = await requireOrganizationIdentity(db, input.organizationId, input.identityId);
  await requireOrganizationIdentityManagement(db, {
    memberId: identity.member_id,
    actorUserId: actor.userId,
    databaseUserId: actor.databaseUserId,
    staffAuthorized: actor.staffAuthorized,
  });
  const at = nowIso();
  const guard = prepareOrganizationIdentityManagementGuard(db, {
    memberId: identity.member_id,
    actorUserId: actor.userId,
    databaseUserId: actor.databaseUserId,
    staffAuthorized: actor.staffAuthorized,
  });
  const context = await loadIdentityNotificationContext(db, identity.member_id, identity.user_id, false);

  if (input.transition.state === "active") {
    requireActivationPermission(actor);
    const permissionGuard = preparePermissionsAuthorizationGuard(db, actor.permissionActor!, [
      { permission: "identities:activate" },
    ]);
    if (identity.started_at && !identity.ended_at && !identity.blocked_at) {
      throw new AppError(409, "IDENTITY_ALREADY_ACTIVE", "The identity is already active");
    }
    if (!identity.started_at && !identity.ended_at && !identity.blocked_at) {
      await commitIdentityLifecycleBatch(db, [
        guard,
        permissionGuard,
        db
          .prepare(
            `UPDATE identities SET started_at = ?, updated_at = ?
              WHERE id = ? AND started_at IS NULL AND ended_at IS NULL AND blocked_at IS NULL AND updated_at = ?`,
          )
          .bind(at, at, identity.id, identity.updated_at),
        prepareScopedAuditLogAfterOneChange(
          db,
          { type: "organization", id: identity.member_id },
          actor.actorType,
          actor.userId,
          "organization_identity_activated",
          "identity",
          identity.id,
          { organizationId: input.organizationId, reason: input.transition.reason ?? null },
          at,
        ),
        prepareIdentityNotification(db, {
          identityId: identity.id,
          userId: identity.user_id,
          context,
          action: "activated",
          at,
        }),
        ...prepareAutomaticGroupEnrollmentForUserStatements(db, identity.user_id, at),
      ]);
      return { identityId: identity.id, state: "active" };
    }

    const successor = await buildCreateIdentityStatement(db, {
      userId: identity.user_id,
      organizationId: identity.organization_id,
      emailId: identity.email_id,
      jobTitle: identity.job_title,
      biography: identity.biography,
      linksJson: identity.links_json,
      source: "staff",
      showOnOrganizationProfile: identity.show_on_organization_profile === 1,
      startImmediately: true,
      predecessorIdentityId: identity.id,
      now: at,
    });
    await commitIdentityLifecycleBatch(db, [
      guard,
      permissionGuard,
      successor.statement,
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "organization", id: identity.member_id },
        actor.actorType,
        actor.userId,
        "organization_identity_successor_activated",
        "identity",
        successor.identityId,
        {
          organizationId: input.organizationId,
          predecessorIdentityId: identity.id,
          reason: input.transition.reason ?? null,
        },
        at,
      ),
      prepareIdentityNotification(db, {
        identityId: successor.identityId,
        userId: identity.user_id,
        context,
        action: "activated",
        at,
      }),
      ...prepareAutomaticGroupEnrollmentForUserStatements(db, identity.user_id, at),
    ]);
    return { identityId: successor.identityId, state: "active" };
  }

  if (identity.ended_at || identity.blocked_at) {
    throw new AppError(409, "IDENTITY_INACTIVE", "The identity is already ended or blocked");
  }
  const blocked = input.transition.state === "blocked";
  await commitIdentityLifecycleBatch(db, [
    guard,
    db
      .prepare(
        `UPDATE identities
            SET ended_at = ?, blocked_at = ?, blocked_by_user_id = ?, updated_at = ?
          WHERE id = ? AND ended_at IS NULL AND blocked_at IS NULL AND updated_at = ?`,
      )
      .bind(
        blocked ? at : at,
        blocked ? at : null,
        blocked ? actor.databaseUserId : null,
        at,
        identity.id,
        identity.updated_at,
      ),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "organization", id: identity.member_id },
      actor.actorType,
      actor.userId,
      blocked ? "organization_identity_blocked" : "organization_identity_ended",
      "identity",
      identity.id,
      { organizationId: input.organizationId, reason: input.transition.reason },
      at,
    ),
    prepareIdentityNotification(db, {
      identityId: identity.id,
      userId: identity.user_id,
      context,
      action: blocked ? "blocked" : "ended",
      at,
    }),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, identity.user_id, at),
  ]);
  return { identityId: identity.id, state: blocked ? "blocked" : "ended" };
}
