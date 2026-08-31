import type { z } from "zod";
import { userUpdateSchema } from "../../../assets/shared/schemas/user-management";
import { all, first } from "../db/queries";
import { hasPermission, requirePermission } from "../auth/permissions";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../types";
import { normalizeEmail } from "../validation";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { prepareUserProfileStatement, type UserProfilePatch } from "./users";
import { buildUserAccessOffboardingStatements } from "./membership/offboarding";
import { findUserEmailOwner } from "./user-emails";
import {
  prepareRotateUserProposalSpeakerManageSecrets,
  prepareRotateUserRegistrationManageSecrets,
} from "./registrations/manage-capability-revocation";
import { authorizedUserMutationDb } from "./user-management-authorization";

type UserUpdateInput = z.infer<typeof userUpdateSchema>;

interface UserUpdateRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  role: string;
  active: number;
  is_ec_member: number;
  pii_redacted_at: string | null;
  merged_into_user_id: string | null;
  pending_email: string | null;
  pending_email_change_registration_id: string | null;
  updated_at: string;
}

function profilePatch(input: UserUpdateInput): UserProfilePatch {
  return {
    ...(input.firstName !== undefined ? { firstName: input.firstName || null } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName || null } : {}),
    ...(input.preferredName !== undefined ? { preferredName: input.preferredName || null } : {}),
  };
}

function changedProfileFields(user: UserUpdateRow, patch: UserProfilePatch): string[] {
  const fields = [
    ["firstName", "first_name"],
    ["lastName", "last_name"],
    ["preferredName", "preferred_name"],
  ] as const;
  const patchValues = {
    firstName: patch.firstName,
    lastName: patch.lastName,
    preferredName: patch.preferredName,
  };
  return fields
    .filter(([inputKey, column]) => patchValues[inputKey] !== undefined && patchValues[inputKey] !== user[column])
    .map(([inputKey]) => inputKey);
}

/**
 * The legacy users.role column is still an authorization boundary: role=admin
 * is the global permission bypass. Keep its mutation subject to the same
 * permission-bundle containment rule as assigning role-admin through
 * user_roles, rather than allowing users:write to manufacture access:grant.
 */
async function requireLegacyRoleChangeAuthorization(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  targetUserId: string,
  currentRole: string,
  nextRole: string,
): Promise<void> {
  if (currentRole === nextRole) return;
  if (actor.identityType === "user" && actor.id === targetUserId) {
    throw new AppError(403, "FORBIDDEN", "You cannot change your own account role");
  }

  requirePermission(actor, "access:grant");

  // role=admin is a global all-permissions role. Match assignUserRole's
  // containment check so a scoped staff actor cannot grant a bundle broader
  // than the permissions they themselves hold.
  if (nextRole !== "admin") return;
  const bundledPermissions = await all<{ permission: string }>(
    db,
    `SELECT rp.permission
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
      WHERE r.name = 'admin'`,
  );
  if (bundledPermissions.length === 0) {
    throw new AppError(500, "ROLE_CONFIGURATION_INVALID", "The admin role has no configured permission bundle");
  }
  for (const { permission } of bundledPermissions) {
    if (!hasPermission(actor, permission)) {
      throw new AppError(403, "PERMISSION_REQUIRED", `Cannot grant the admin role without holding: ${permission}`);
    }
  }
}

/** Validates and commits an user update and its audit row atomically. */
export async function updateUser(db: DatabaseLike, actor: UserBackedAuthAdmin, userId: string, input: UserUpdateInput) {
  if (userId === actor.id && input.role !== undefined && input.role !== "admin") {
    throw new AppError(403, "FORBIDDEN", "You cannot demote your own account");
  }
  if (userId === actor.id && input.active === false) {
    throw new AppError(403, "FORBIDDEN", "You cannot deactivate your own account");
  }
  const user = await first<UserUpdateRow>(
    db,
    `SELECT id, email, first_name, last_name, preferred_name,
            role, active, is_ec_member, pii_redacted_at,
            merged_into_user_id, pending_email, pending_email_change_registration_id, updated_at
     FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  if (user.pii_redacted_at) {
    throw new AppError(409, "ALREADY_ANONYMIZED", "An anonymized account cannot be modified");
  }
  if (user.merged_into_user_id) {
    throw new AppError(409, "IDENTITY_RETIRED", "A previously merged account cannot be modified or reactivated");
  }

  const role = input.role ?? user.role;
  await requireLegacyRoleChangeAuthorization(db, actor, user.id, user.role, role);

  let email = user.email;
  let promotedSecondaryEmail: string | null = null;
  if (input.email !== undefined) {
    const normalized = normalizeEmail(input.email);
    if (normalized !== normalizeEmail(user.email)) {
      // A primary address is an authentication identifier, not ordinary
      // profile data. users:write is sufficient for profile edits, while a
      // direct staff correction must carry the same elevated authority used to
      // grant or revoke access.
      requirePermission(actor, "access:grant");
      const owner = await findUserEmailOwner(db, normalized);
      if (owner && owner.userId !== user.id) {
        throw new AppError(409, "EMAIL_ALREADY_IN_USE", "Another account already uses that email address");
      }
      if (owner?.kind === "pending") {
        throw new AppError(409, "EMAIL_CHANGE_PENDING", "That email address has a pending verification request");
      }
      if (owner?.kind === "secondary") promotedSecondaryEmail = normalized;
      email = normalized;
    }
  }
  const active = input.active ?? Boolean(user.active);
  const isEcMember = input.isEcMember ?? Boolean(user.is_ec_member);
  const patch = profilePatch(input);
  const profileFields = changedProfileFields(user, patch);
  const changedFields = [
    ...(email !== user.email ? ["email"] : []),
    ...profileFields,
    ...(input.role !== undefined && role !== user.role ? ["role"] : []),
    ...(input.active !== undefined && active !== Boolean(user.active) ? ["active"] : []),
    ...(input.isEcMember !== undefined && isEcMember !== Boolean(user.is_ec_member) ? ["isEcMember"] : []),
  ];
  if (changedFields.length === 0) {
    return { id: user.id, email, role, active, isEcMember };
  }
  const statements: StatementLike[] = [];
  const at = new Date().toISOString();
  const clearPendingEmailChange =
    email !== user.email && Boolean(user.pending_email && user.pending_email_change_registration_id);
  if (promotedSecondaryEmail) {
    statements.push(
      db
        .prepare("DELETE FROM user_emails WHERE user_id = ? AND normalized_email = ?")
        .bind(user.id, promotedSecondaryEmail),
    );
  }
  if (clearPendingEmailChange && user.pending_email_change_registration_id) {
    // A direct admin correction supersedes an older unverified request. Make
    // its confirmation capability unusable in the same batch so a delayed
    // click cannot overwrite the newer authoritative address.
    statements.push(
      db
        .prepare(
          `UPDATE registrations
              SET confirmation_link_secret = NULL,
                  pending_confirmation_deadline_at = NULL,
                  confirmation_reminder_sent_at = NULL,
                  created_identity_user_id = NULL,
                  transition_revision = transition_revision + 1,
                  updated_at = ?
            WHERE id = ? AND user_id = ?`,
        )
        .bind(at, user.pending_email_change_registration_id, user.id),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE users
         SET email = ?, normalized_email = ?, role = ?, active = ?, is_ec_member = ?,
             pending_email = CASE WHEN ? = 1 THEN NULL ELSE pending_email END,
             pending_email_expires_at = CASE WHEN ? = 1 THEN NULL ELSE pending_email_expires_at END,
             pending_email_change_registration_id = CASE
               WHEN ? = 1 THEN NULL ELSE pending_email_change_registration_id END,
             updated_at = ?
         WHERE id = ?
           AND pii_redacted_at IS NULL
           AND merged_into_user_id IS NULL
           AND updated_at = ?`,
      )
      .bind(
        email,
        normalizeEmail(email),
        role,
        active ? 1 : 0,
        isEcMember ? 1 : 0,
        clearPendingEmailChange ? 1 : 0,
        clearPendingEmailChange ? 1 : 0,
        clearPendingEmailChange ? 1 : 0,
        at,
        user.id,
        user.updated_at,
      ),
    prepareAuditLogAfterOneChange(db, "admin", actor.id, "user_updated", "user", user.id, {
      changedFields,
      ...(role !== user.role ? { role: { from: user.role, to: role } } : {}),
      ...(active !== Boolean(user.active) ? { active: { from: Boolean(user.active), to: active } } : {}),
      ...(isEcMember !== Boolean(user.is_ec_member)
        ? { isEcMember: { from: Boolean(user.is_ec_member), to: isEcMember } }
        : {}),
    }),
  );
  if (Object.keys(patch).length > 0) statements.push(prepareUserProfileStatement(db, user.id, patch));
  const deactivating = user.active === 1 && !active;
  const changingPrimaryEmail = email !== user.email;
  const authorizedDb = authorizedUserMutationDb(db, actor, [
    "users:write",
    ...(role !== user.role || changingPrimaryEmail ? (["access:grant"] as const) : []),
  ]);
  if (deactivating || changingPrimaryEmail) {
    // Deactivation and canonical login changes share one credential-revocation
    // boundary. Do not retain bearer sessions issued to an inactive account or
    // the former mailbox. Signed email-auth capabilities are checked against
    // the current email and eligibility when used.
    statements.push(
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, user.id),
    );
  }
  if (changingPrimaryEmail) {
    statements.push(
      prepareRotateUserRegistrationManageSecrets(db, user.id, at),
      prepareRotateUserProposalSpeakerManageSecrets(db, user.id),
    );
  }
  if (deactivating) {
    statements.push(
      ...(await buildUserAccessOffboardingStatements(db, {
        userId: user.id,
        causeKey: `user:${user.id}:deactivate:${user.updated_at}`,
        at,
      })),
    );
  }
  try {
    await authorizedDb.batch(statements);
  } catch (error) {
    if (!isAuditChangeGuardFailure(error)) throw error;
    const current = await first<{ pii_redacted_at: string | null; merged_into_user_id: string | null }>(
      db,
      "SELECT pii_redacted_at, merged_into_user_id FROM users WHERE id = ?",
      [user.id],
    );
    if (current?.pii_redacted_at) {
      throw new AppError(409, "ALREADY_ANONYMIZED", "An anonymized account cannot be modified");
    }
    if (current?.merged_into_user_id) {
      throw new AppError(409, "IDENTITY_RETIRED", "A previously merged account cannot be modified or reactivated");
    }
    throw new AppError(409, "USER_UPDATE_CONFLICT", "The user changed while this update was being prepared");
  }
  return { id: user.id, email, role, active, isEcMember };
}
