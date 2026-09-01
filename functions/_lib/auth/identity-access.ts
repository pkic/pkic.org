import { requireAdminFromRequest } from "./admin";
import { requireMemberFromRequest } from "./member";
import { hasPermission, requirePermission } from "./permissions";
import { AppError } from "../errors";
import type { DatabaseLike, Env } from "../types";
import type { IdentityManagerActor } from "../services/identities";

export async function requireIdentityManagerActor(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
): Promise<IdentityManagerActor> {
  try {
    const admin = await requireAdminFromRequest(db, request, env);
    requirePermission(admin, "membership:write");
    return {
      userId: admin.id,
      databaseUserId: admin.identityType === "user" ? admin.id : null,
      actorType: "admin",
      staffAuthorized: true,
      immediateActivationAuthorized: admin.identityType === "user" && hasPermission(admin, "identities:activate"),
      permissionActor: admin.identityType === "user" ? admin : undefined,
    };
  } catch (error) {
    if (!(error instanceof AppError) || (error.status !== 401 && error.code !== "PERMISSION_REQUIRED")) {
      throw error;
    }
  }
  const member = await requireMemberFromRequest(db, request, env);
  return {
    userId: member.userId,
    databaseUserId: member.userId,
    actorType: "member",
    staffAuthorized: false,
    immediateActivationAuthorized: false,
  };
}
