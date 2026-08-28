import { AppError } from "../errors";
import type { AuthMember, DatabaseLike, Env, UserBackedAuthAdmin } from "../types";
import { hasPermission } from "./permissions";
import { resolveUserSessionFromRequest } from "./user-session";

export type GroupViewer =
  | { kind: "public"; userId?: undefined; staff?: undefined; member?: undefined; canReadAll: false }
  | {
      kind: "user";
      userId: string;
      staff?: UserBackedAuthAdmin;
      member?: AuthMember;
      canReadAll: boolean;
    };

/** Resolves an optional portal identity without turning public reads into authentication failures. */
export async function resolveOptionalGroupViewer(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
): Promise<GroupViewer> {
  try {
    const session = await resolveUserSessionFromRequest(db, request, {
      INTERNAL_SIGNING_SECRET: env?.INTERNAL_SIGNING_SECRET,
    });
    return {
      kind: "user",
      userId: session.identity.id,
      ...(session.staff ? { staff: session.staff } : {}),
      ...(session.member ? { member: session.member } : {}),
      canReadAll: session.staff ? hasPermission(session.staff, "groups:read") : false,
    };
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 401) throw error;
  }
  return { kind: "public", canReadAll: false };
}
