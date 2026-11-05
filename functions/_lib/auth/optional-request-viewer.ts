import { prepareUserBackedAdminFromRequest, readAdminCredential } from "./admin";
import { createUserBackedAuthAdmin } from "./admin-identity";
import { userSessionMemberSelection } from "./identity-capacities";
import { prepareOptionalUserSessionRequest } from "./user-session-request";
import { getUserSessionToken } from "./user-session-token";
import type { UserSessionResult } from "./user-session-result";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import type { DatabaseLike, D1StatementResult, Env, StatementLike, UserBackedAuthAdmin } from "../types";

export interface PreparedRequestViewerRead {
  /** Only a human session can supply implicit membership and participation access. */
  userId: string | null;
  permissionActor: UserBackedAuthAdmin;
  memberSelection?: AuthorizationEvidence;
  statements: StatementLike[];
  decode(results: D1StatementResult[]): Promise<{ session: UserSessionResult | null; staff?: UserBackedAuthAdmin }>;
}

/** Select the canonical verifier without treating delegated credentials as human sessions. */
export async function prepareOptionalRequestViewer(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET" | "ADMIN_API_KEY">,
): Promise<PreparedRequestViewerRead | null> {
  if (!getUserSessionToken(request)) return null;
  if ((await readAdminCredential(request, env)).kind === "mcp") {
    const read = await prepareUserBackedAdminFromRequest(db, request, env);
    if (!read) throw new Error("Delegated credential did not resolve an attributable actor");
    return {
      userId: null,
      permissionActor: read.permissionActor,
      memberSelection: read.memberSelection,
      statements: read.statements,
      async decode(results) {
        return { session: null, staff: await read.decode(results) };
      },
    };
  }
  const read = await prepareOptionalUserSessionRequest(db, request, env);
  if (!read) return null;
  return {
    userId: read.claims.sub,
    permissionActor: createUserBackedAuthAdmin({ id: read.claims.sub, sessionId: read.claims.sid, email: "" }),
    memberSelection: userSessionMemberSelection(read.claims.sub, read.claims.iid),
    statements: read.statements,
    async decode(results) {
      const session = await read.decode(results);
      return { session, staff: session.staff };
    },
  };
}
