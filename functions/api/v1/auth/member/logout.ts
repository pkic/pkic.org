import {
  getMemberSessionCookieToken,
  revokeMemberSession,
  serializeExpiredMemberSessionCookie,
  verifyMemberSessionToken,
} from "../../../../_lib/auth/member";
import type { AdminContext } from "../../../../_lib/db/context";
import { logoutSession, type SessionLogoutPolicy } from "../../../../_lib/auth/http-flow";
import { dispatchPostOnly } from "../../../../_lib/http";

const MEMBER_LOGOUT_POLICY = {
  readCookie: getMemberSessionCookieToken,
  verify: verifyMemberSessionToken,
  revoke: revokeMemberSession,
  serializeExpiredCookie: serializeExpiredMemberSessionCookie,
} satisfies SessionLogoutPolicy;

export async function onRequestPost(c: AdminContext): Promise<Response> {
  return logoutSession(c, MEMBER_LOGOUT_POLICY);
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
