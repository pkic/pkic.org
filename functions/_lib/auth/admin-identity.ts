import { AppError } from "../errors";
import type { AuthAdmin } from "../types";

/** Resolves the nullable users(id) identity separately from the audit actor ID. */
export function adminDatabaseUserId(actor: AuthAdmin): string | null {
  if (actor.databaseUserId === undefined) {
    throw new AppError(500, "ADMIN_IDENTITY_UNCLASSIFIED", "The admin actor has no database-user classification");
  }
  return actor.databaseUserId;
}

/** Removes internal relational identity before returning an admin to a client. */
export function publicAuthAdmin(actor: AuthAdmin): Omit<AuthAdmin, "databaseUserId"> {
  const { databaseUserId: _databaseUserId, ...publicAdmin } = actor;
  return publicAdmin;
}

/** Requires a real users(id) identity for records whose attribution is mandatory. */
export function requireAdminDatabaseUserId(actor: AuthAdmin): string {
  const userId = adminDatabaseUserId(actor);
  if (!userId) {
    throw new AppError(
      403,
      "USER_BACKED_ADMIN_REQUIRED",
      "This action requires an attributable admin session rather than the shared API key",
    );
  }
  return userId;
}
