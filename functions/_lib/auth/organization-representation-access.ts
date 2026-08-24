import { requireAdminFromRequest } from "./admin";
import { requireMemberFromRequest } from "./member";
import { requirePermission } from "./permissions";
import { AppError } from "../errors";
import type { DatabaseLike, Env } from "../types";
import type { RepresentativeManagerActor } from "../services/organization-representations";

export async function requireRepresentativeManagerActor(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
): Promise<RepresentativeManagerActor> {
  try {
    const admin = await requireAdminFromRequest(db, request, env);
    requirePermission(admin, "membership:write");
    return {
      userId: admin.id,
      databaseUserId: admin.identityType === "user" ? admin.id : null,
      actorType: "admin",
      staffAuthorized: true,
    };
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 401) throw error;
  }
  const member = await requireMemberFromRequest(db, request, env);
  return {
    userId: member.userId,
    databaseUserId: member.userId,
    actorType: "member",
    staffAuthorized: false,
  };
}
