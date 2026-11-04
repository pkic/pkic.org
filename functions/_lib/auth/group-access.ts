import { AppError } from "../errors";
import type { AuthMember, DatabaseLike, Env, UserBackedAuthAdmin } from "../types";
import { hasPermission } from "./permissions";
import { resolveUserSessionFromRequest } from "./user-session";
import { sessionHoldsCapacity } from "./user-session-result";
import { readAdminCredential, requireUserBackedAdminFromRequest } from "./admin";

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
    if ((await readAdminCredential(request, env)).kind === "mcp") {
      const staff = await requireUserBackedAdminFromRequest(db, request, env);
      // Delegation carries selected staff permissions, never implicit membership powers.
      if (!staff.scopes?.some((scope) => scope === "groups:read" || scope === "groups:write")) {
        return { kind: "public", canReadAll: false };
      }
      return { kind: "user", userId: staff.id, staff, canReadAll: hasPermission(staff, "groups:read") };
    }
    const session = await resolveUserSessionFromRequest(db, request, {
      INTERNAL_SIGNING_SECRET: env?.INTERNAL_SIGNING_SECRET,
    });
    // A user with no capacity reads the groups the public reads; `authenticated` visibility is for people who hold one.
    if (!sessionHoldsCapacity(session)) return { kind: "public", canReadAll: false };
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
