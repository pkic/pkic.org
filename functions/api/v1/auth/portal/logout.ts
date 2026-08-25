import {
  getAdminSessionCookieToken,
  prepareRevokeAdminSession,
  revokeAdminSession,
  serializeExpiredAdminSessionCookie,
  verifyAdminSessionToken,
} from "../../../../_lib/auth/admin";
import {
  getMemberSessionCookieToken,
  prepareRevokeMemberSession,
  revokeMemberSession,
  serializeExpiredMemberSessionCookie,
  verifyMemberSessionToken,
} from "../../../../_lib/auth/member";
import { getBearerToken } from "../../../../_lib/auth/session-engine";
import { logoutSessions, type SessionLogoutPolicy } from "../../../../_lib/auth/http-flow";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { AdminContext } from "../../../../_lib/db/context";
import { portalAuthLogoutRouteSchema } from "../../../../../assets/shared/schemas/portal-auth";

const PORTAL_LOGOUT_POLICIES = [
  {
    readCookie: getAdminSessionCookieToken,
    readToken: (request) => getBearerToken(request) ?? getAdminSessionCookieToken(request),
    verify: verifyAdminSessionToken,
    revoke: revokeAdminSession,
    prepareRevoke: prepareRevokeAdminSession,
    serializeExpiredCookie: serializeExpiredAdminSessionCookie,
  },
  {
    readCookie: getMemberSessionCookieToken,
    readToken: (request) => getBearerToken(request) ?? getMemberSessionCookieToken(request),
    verify: verifyMemberSessionToken,
    revoke: revokeMemberSession,
    prepareRevoke: prepareRevokeMemberSession,
    serializeExpiredCookie: serializeExpiredMemberSessionCookie,
  },
] satisfies readonly SessionLogoutPolicy[];

export const PortalAuthLogout = openApiRoute(portalAuthLogoutRouteSchema, async (c: AdminContext) =>
  logoutSessions(c, PORTAL_LOGOUT_POLICIES),
);
