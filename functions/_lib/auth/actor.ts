/**
 * Shared actor resolution for endpoints usable by either staff (AuthAdmin)
 * or ordinary members (AuthMember) holding the *same* underlying identity
 * concept (a `users.id` row) — today, just the passkey endpoints
 * (`/api/v1/auth/passkeys/*`), which are keyed on
 * `passkey_credentials.user_id` regardless of which session type owns it.
 *
 * Tries a user-backed admin session first (cookie name `pkic_admin_session`),
 * then the member session (`pkic_member_session`). Synthetic admin transports
 * such as the shared API key cannot own passkeys and fail closed.
 * The two sessions use distinct cookies/JWT `typ` claims, so at most one
 * normally resolves for a given browser. A generic 401 is thrown only if neither
 * does, rather than surfacing whichever specific error came first, since
 * this endpoint is reachable from both the admin and member portal
 * frontends and neither error is more "correct" than the other from the
 * caller's point of view.
 */
import { AppError } from "../errors";
import { requireUserBackedAdminFromRequest } from "./admin";
import { requireAdminDatabaseUserId } from "./admin-identity";
import { requireMemberFromRequest } from "./member";
import type { DatabaseLike, Env } from "../types";

export type AuthActor = { kind: "admin"; id: string; email: string } | { kind: "member"; id: string; email: string };

export async function requireAnyActorFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
): Promise<AuthActor> {
  try {
    const admin = await requireUserBackedAdminFromRequest(db, request, env);
    return { kind: "admin", id: requireAdminDatabaseUserId(admin), email: admin.email };
  } catch (adminError) {
    // Only a 401 means "not this kind of actor" — fall through to the
    // member check. Anything else (e.g. a 500 from missing
    // INTERNAL_SIGNING_SECRET) is a real failure, not an actor mismatch.
    if (!(adminError instanceof AppError) || adminError.status !== 401) throw adminError;
  }

  try {
    const member = await requireMemberFromRequest(db, request, env);
    return { kind: "member", id: member.userId, email: member.email };
  } catch (memberError) {
    if (!(memberError instanceof AppError) || memberError.status !== 401) throw memberError;
  }

  throw new AppError(401, "AUTH_REQUIRED", "Missing bearer token");
}
