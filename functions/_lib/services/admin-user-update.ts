import type { z } from "zod";
import { adminUserUpdateSchema } from "../../../assets/shared/schemas/api";
import { serializeLinks } from "../../../assets/shared/schemas/links";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { normalizeEmail } from "../validation";
import { prepareAuditLog } from "./audit";
import { prepareUserProfileStatement, type UserProfilePatch } from "./users";

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
            job_title, biography, links_json, role, active, is_ec_member, pii_redacted_at
     FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  if (user.pii_redacted_at) {
    throw new AppError(409, "ALREADY_ANONYMIZED", "An anonymized account cannot be modified");
  }

  let email = user.email;
  if (input.email !== undefined) {
    const normalized = normalizeEmail(input.email);
    if (normalized !== normalizeEmail(user.email)) {
      if (
        await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ? AND id != ?", [
          normalized,
          user.id,
        ])
      ) {
        throw new AppError(409, "EMAIL_ALREADY_IN_USE", "Another account already uses that email address");
      }
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
  const statements: StatementLike[] = [];
  if (Object.keys(patch).length > 0) statements.push(prepareUserProfileStatement(db, user.id, patch));
  statements.push(
    db
      .prepare(
        `UPDATE users
         SET email = ?, normalized_email = ?, role = ?, active = ?, is_ec_member = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(email, normalizeEmail(email), role, active ? 1 : 0, isEcMember ? 1 : 0, new Date().toISOString(), user.id),
  );
  if (changedFields.length > 0) {
    statements.push(
      prepareAuditLog(db, "admin", actor.id, "user_updated", "user", user.id, {
        changedFields,
        ...(role !== user.role ? { role: { from: user.role, to: role } } : {}),
        ...(active !== Boolean(user.active) ? { active: { from: Boolean(user.active), to: active } } : {}),
        ...(isEcMember !== Boolean(user.is_ec_member)
          ? { isEcMember: { from: Boolean(user.is_ec_member), to: isEcMember } }
          : {}),
      }),
    );
  }
  await db.batch(statements);
  return { id: user.id, email, role, active, isEcMember };
}
