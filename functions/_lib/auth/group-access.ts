import { AppError } from "../errors";
import type { AuthAdmin, AuthMember, DatabaseLike, Env } from "../types";
import { hasPermission } from "./permissions";
import { requireUserBackedAdminFromRequest } from "./admin";
import { requireMemberFromRequest } from "./member";

export type GroupViewer =
  | { kind: "public"; userId?: undefined; admin?: undefined; member?: undefined; canReadAll: false }
  | { kind: "admin"; userId: string; admin: AuthAdmin; member?: undefined; canReadAll: boolean }
  | { kind: "member"; userId: string; admin?: undefined; member: AuthMember; canReadAll: false };

/** Resolves an optional portal identity without turning public reads into authentication failures. */
export async function resolveOptionalGroupViewer(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
): Promise<GroupViewer> {
  try {
    const admin = await requireUserBackedAdminFromRequest(db, request, env);
    return {
      kind: "admin",
      userId: admin.id,
      admin,
      canReadAll: hasPermission(admin, "groups:read"),
    };
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 401) throw error;
  }
  try {
    const member = await requireMemberFromRequest(db, request, env);
    return { kind: "member", userId: member.userId, member, canReadAll: false };
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 401) throw error;
  }
  return { kind: "public", canReadAll: false };
}
