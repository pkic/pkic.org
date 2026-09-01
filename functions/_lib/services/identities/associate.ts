import { serializeLinks } from "../../../../assets/shared/schemas/links";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { normalizeEmail } from "../../validation";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { buildCreateIdentityStatement } from "../membership/identities";
import { buildFindOrCreateUserStatement, findUserByEmail, splitPersonName } from "../users";
import {
  prepareOrganizationIdentityManagementGuard,
  requireOrganizationIdentityManagement,
  resolveOrganizationMemberId,
} from "./authorization";
import { isConcurrentIdentityConflict } from "./conflicts";
import {
  loadIdentityNotificationContext,
  prepareIdentityNotification,
  type IdentityNotificationContext,
} from "./notifications";
import type { IdentityManagerActor } from "./types";

type Activation = { mode: "invitation" } | { mode: "immediate"; reason: string };

function requireImmediateActivation(actor: IdentityManagerActor, activation: Activation): UserBackedAuthAdmin | null {
  if (activation.mode === "invitation") return null;
  if (!actor.immediateActivationAuthorized || !actor.permissionActor || !actor.databaseUserId) {
    throw new AppError(
      403,
      "IDENTITY_IMMEDIATE_ACTIVATION_REQUIRED",
      "Immediate activation requires membership:write and identities:activate on a user-backed staff session",
    );
  }
  return actor.permissionActor;
}

async function commitIdentityCreation(
  db: DatabaseLike,
  actor: IdentityManagerActor,
  input: {
    memberId: string;
    organizationId: string;
    userId: string;
    emailId?: string | null;
    jobTitle?: string | null;
    biography?: string | null;
    links?: string[];
    showOnOrganizationProfile: boolean;
    activation: Activation;
    userStatement?: StatementLike | null;
    notificationContext?: IdentityNotificationContext;
  },
): Promise<{ identityId: string; state: "pending" | "active" }> {
  await requireOrganizationIdentityManagement(db, {
    memberId: input.memberId,
    actorUserId: actor.userId,
    databaseUserId: actor.databaseUserId,
    staffAuthorized: actor.staffAuthorized,
  });
  const permissionActor = requireImmediateActivation(actor, input.activation);
  const at = nowIso();
  const context =
    input.notificationContext ?? (await loadIdentityNotificationContext(db, input.memberId, input.userId, false));
  const prepared = await buildCreateIdentityStatement(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    emailId: input.emailId,
    jobTitle: input.jobTitle,
    biography: input.biography,
    linksJson: input.links === undefined ? undefined : serializeLinks(input.links),
    source: actor.staffAuthorized ? "staff" : "organization_contact",
    showOnOrganizationProfile: input.showOnOrganizationProfile,
    startImmediately: input.activation.mode === "immediate",
    now: at,
  });
  const statements = [
    prepareOrganizationIdentityManagementGuard(db, {
      memberId: input.memberId,
      actorUserId: actor.userId,
      databaseUserId: actor.databaseUserId,
      staffAuthorized: actor.staffAuthorized,
    }),
    ...(permissionActor
      ? [preparePermissionsAuthorizationGuard(db, permissionActor, [{ permission: "identities:activate" }])]
      : []),
    ...(input.userStatement ? [input.userStatement] : []),
    prepared.statement,
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "organization", id: input.memberId },
      actor.actorType,
      actor.userId,
      input.activation.mode === "immediate" ? "organization_identity_activated" : "organization_identity_invited",
      "identity",
      prepared.identityId,
      {
        userId: input.userId,
        organizationId: input.organizationId,
        emailId: input.emailId ?? null,
        source: actor.staffAuthorized ? "staff" : "organization_contact",
        reason: input.activation.mode === "immediate" ? input.activation.reason : null,
      },
      at,
    ),
    prepareIdentityNotification(db, {
      identityId: prepared.identityId,
      userId: input.userId,
      context,
      action: input.activation.mode === "immediate" ? "activated" : "invited",
      at,
    }),
    ...(input.activation.mode === "immediate"
      ? prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, at)
      : []),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_AUTHORIZATION_CHANGED", "Identity-management access changed while saving");
    }
    if (isConcurrentIdentityConflict(error) || isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_CONFLICT", "The identity changed concurrently; reload and retry");
    }
    throw error;
  }
  return { identityId: prepared.identityId, state: input.activation.mode === "immediate" ? "active" : "pending" };
}

export async function createOrganizationIdentity(
  db: DatabaseLike,
  actor: IdentityManagerActor,
  input: {
    organizationId: string;
    userId: string;
    emailId?: string | null;
    jobTitle?: string | null;
    biography?: string | null;
    links?: string[];
    showOnOrganizationProfile: boolean;
    activation: Activation;
  },
): Promise<{ identityId: string; state: "pending" | "active" }> {
  return commitIdentityCreation(db, actor, {
    ...input,
    memberId: await resolveOrganizationMemberId(db, input.organizationId),
  });
}

export async function createOrganizationIdentityByEmail(
  db: DatabaseLike,
  actor: IdentityManagerActor,
  input: {
    organizationId: string;
    email: string;
    name: string;
    jobTitle?: string;
    biography?: string;
    links?: string[];
    showOnOrganizationProfile: boolean;
    activation: Activation;
  },
): Promise<{ identityId: string; state: "pending" | "active" }> {
  const existingUser = await findUserByEmail(db, input.email);
  const { firstName, lastName } = existingUser
    ? { firstName: undefined, lastName: undefined }
    : splitPersonName(input.name);
  const { user, statement: userStatement } = await buildFindOrCreateUserStatement(db, {
    email: input.email,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
  });
  const normalizedInputEmail = normalizeEmail(input.email);
  const emailId =
    normalizeEmail(user.email) === normalizedInputEmail
      ? null
      : (
          await first<{ id: string }>(
            db,
            `SELECT id FROM user_emails
              WHERE user_id = ? AND normalized_email = ? AND verified_at IS NOT NULL`,
            [user.id, normalizedInputEmail],
          )
        )?.id;
  if (emailId === undefined) {
    throw new AppError(
      422,
      "IDENTITY_EMAIL_UNVERIFIED",
      "A selected secondary email must be verified before it can identify an organization identity",
    );
  }
  const organization = await first<{ name: string }>(db, "SELECT name FROM organizations WHERE id = ?", [
    input.organizationId,
  ]);
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  return commitIdentityCreation(db, actor, {
    memberId: await resolveOrganizationMemberId(db, input.organizationId),
    organizationId: input.organizationId,
    userId: user.id,
    emailId,
    jobTitle: input.jobTitle,
    biography: input.biography,
    links: input.links,
    showOnOrganizationProfile: input.showOnOrganizationProfile,
    activation: input.activation,
    userStatement,
    notificationContext: {
      email: user.email,
      recipient_name: [user.first_name, user.last_name].filter(Boolean).join(" ") || input.name,
      organization_name: organization.name,
    },
  });
}
