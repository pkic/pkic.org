import type { z } from "zod";
import { adminUserUpdateSchema } from "../../../assets/shared/schemas/admin-users";
import { serializeLinks } from "../../../assets/shared/schemas/links";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { normalizeEmail } from "../validation";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { prepareUserProfileStatement, type UserProfilePatch } from "./users";
import { buildUserAccessOffboardingStatements } from "./membership/offboarding";
import { findUserEmailOwner } from "./user-emails";

type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;

interface AdminUserUpdateRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  role: string;
  active: number;
  is_ec_member: number;
  pii_redacted_at: string | null;
  merged_into_user_id: string | null;
  updated_at: string;
}

function profilePatch(input: AdminUserUpdateInput): UserProfilePatch {
  return {
    ...(input.firstName !== undefined ? { firstName: input.firstName || null } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName || null } : {}),
    ...(input.preferredName !== undefined ? { preferredName: input.preferredName || null } : {}),
    ...(input.organizationName !== undefined ? { organizationName: input.organizationName || null } : {}),
    ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle || null } : {}),
    ...(input.biography !== undefined ? { biography: input.biography || null } : {}),
    ...(input.links !== undefined
      ? { linksJson: input.links && input.links.length > 0 ? serializeLinks(input.links) : null }
      : {}),
  };
}

function changedProfileFields(user: AdminUserUpdateRow, patch: UserProfilePatch): string[] {
  const fields = [
    ["firstName", "first_name"],
    ["lastName", "last_name"],
    ["preferredName", "preferred_name"],
    ["organizationName", "organization_name"],
    ["jobTitle", "job_title"],
    ["biography", "biography"],
    ["links", "links_json"],
  ] as const;
  const patchValues = {
    firstName: patch.firstName,
    lastName: patch.lastName,
    preferredName: patch.preferredName,
    organizationName: patch.organizationName,
    jobTitle: patch.jobTitle,
    biography: patch.biography,
    links: patch.linksJson,
  };
  return fields
    .filter(([inputKey, column]) => patchValues[inputKey] !== undefined && patchValues[inputKey] !== user[column])
    .map(([inputKey]) => inputKey);
}

/** Validates and commits an admin user update and its audit row atomically. */
export async function updateAdminUser(db: DatabaseLike, actor: AuthAdmin, userId: string, input: AdminUserUpdateInput) {
  if (userId === actor.id && input.role !== undefined && input.role !== "admin") {
    throw new AppError(403, "FORBIDDEN", "You cannot demote your own account");
  }
  if (userId === actor.id && input.active === false) {
    throw new AppError(403, "FORBIDDEN", "You cannot deactivate your own account");
  }
  const user = await first<AdminUserUpdateRow>(
    db,
    `SELECT id, email, first_name, last_name, preferred_name, organization_name,
            job_title, biography, links_json, role, active, is_ec_member, pii_redacted_at,
            merged_into_user_id, updated_at
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

  let email = user.email;
  let promotedSecondaryEmail: string | null = null;
  if (input.email !== undefined) {
    const normalized = normalizeEmail(input.email);
    if (normalized !== normalizeEmail(user.email)) {
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
  const role = input.role ?? user.role;
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
  if (promotedSecondaryEmail) {
    statements.push(
      db
        .prepare("DELETE FROM user_emails WHERE user_id = ? AND normalized_email = ?")
        .bind(user.id, promotedSecondaryEmail),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE users
         SET email = ?, normalized_email = ?, role = ?, active = ?, is_ec_member = ?, updated_at = ?
         WHERE id = ?
           AND pii_redacted_at IS NULL
           AND merged_into_user_id IS NULL
           AND updated_at = ?`,
      )
      .bind(email, normalizeEmail(email), role, active ? 1 : 0, isEcMember ? 1 : 0, at, user.id, user.updated_at),
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
  if (user.active === 1 && !active) {
    statements.push(
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, user.id),
      db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, user.id),
      ...(await buildUserAccessOffboardingStatements(db, {
        userId: user.id,
        causeKey: `user:${user.id}:deactivate:${user.updated_at}`,
        at,
      })),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (!isAuditOneChangeGuardFailure(error)) throw error;
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
