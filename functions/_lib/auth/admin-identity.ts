import { AppError } from "../errors";
import { publicAuthAdminSchema, type PublicAuthAdmin } from "../../../assets/shared/schemas/admin-auth";
import type { AuthAdmin, ServiceAuthAdmin, UserBackedAuthAdmin } from "../types";

type UserBackedAuthAdminInput = Omit<UserBackedAuthAdmin, "identityType">;
type ServiceAuthAdminInput = Omit<ServiceAuthAdmin, "identityType">;

export function createUserBackedAuthAdmin(input: UserBackedAuthAdminInput): UserBackedAuthAdmin {
  return { identityType: "user", ...input };
}

export function createServiceAuthAdmin(input: ServiceAuthAdminInput): ServiceAuthAdmin {
  return { identityType: "service", ...input };
}

export function isUserBackedAuthAdmin(actor: AuthAdmin): actor is UserBackedAuthAdmin {
  return actor.identityType === "user";
}

/** Resolves the nullable users(id) identity separately from the audit actor ID. */
export function adminDatabaseUserId(actor: AuthAdmin): string | null {
  return isUserBackedAuthAdmin(actor) ? actor.id : null;
}

/** Explicitly maps the only admin fields that may cross a public transport boundary. */
export function publicAuthAdmin(actor: AuthAdmin): PublicAuthAdmin {
  return publicAuthAdminSchema.parse({
    id: actor.id,
    email: actor.email,
    role: actor.role,
    scopes: actor.scopes ?? [],
    grants: actor.grants ?? [],
    expiresAt: isUserBackedAuthAdmin(actor) ? (actor.expiresAt ?? null) : null,
  });
}

/** Narrows an authenticated actor before any operation that requires users(id). */
export function requireUserBackedAuthAdmin(actor: AuthAdmin): UserBackedAuthAdmin {
  if (!isUserBackedAuthAdmin(actor)) {
    throw new AppError(
      403,
      "USER_BACKED_ADMIN_REQUIRED",
      "This action requires an attributable admin session rather than the shared API key",
    );
  }
  return actor;
}

/** Requires a real users(id) identity for records whose attribution is mandatory. */
export function requireAdminDatabaseUserId(actor: AuthAdmin): string {
  return requireUserBackedAuthAdmin(actor).id;
}
