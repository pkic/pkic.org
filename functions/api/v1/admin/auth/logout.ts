import {
  getAdminSessionCookieToken,
  revokeAdminSession,
  serializeExpiredAdminSessionCookie,
  verifyAdminSessionToken,
} from "../../../../_lib/auth/admin";
import type { AdminContext } from "../../../../_lib/db/context";
import { logoutSession, type SessionLogoutPolicy } from "../../../../_lib/auth/http-flow";
import { dispatchPostOnly } from "../../../../_lib/http";

const ADMIN_LOGOUT_POLICY = {
  readCookie: getAdminSessionCookieToken,
  verify: verifyAdminSessionToken,
  revoke: revokeAdminSession,
  serializeExpiredCookie: serializeExpiredAdminSessionCookie,
} satisfies SessionLogoutPolicy;

export async function onRequestPost(c: AdminContext): Promise<Response> {
  return logoutSession(c, ADMIN_LOGOUT_POLICY);
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
