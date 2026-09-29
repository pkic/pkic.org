/**
 * Resolves the one authenticated human identity used by shared account
 * operations. Staff and member are live capacities of that user, not separate
 * authentication actors or session types.
 */
import { AppError } from "../errors";
import { resolveUserSessionFromRequest } from "./user-session";
import type { DatabaseLike, Env } from "../types";

export type AuthActor = {
  kind: "user";
  id: string;
  email: string;
  capacities: { staff: boolean; member: boolean };
};

export async function requireAnyActorFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
): Promise<AuthActor> {
  const session = await resolveUserSessionFromRequest(db, request, {
    INTERNAL_SIGNING_SECRET: env?.INTERNAL_SIGNING_SECRET,
  });
  if (!session.staff && !session.member) throw new AppError(401, "AUTH_REQUIRED", "No active user capacity");
  return {
    kind: "user",
    id: session.identity.id,
    email: session.identity.email,
    capacities: { staff: Boolean(session.staff), member: Boolean(session.member) },
  };
}
