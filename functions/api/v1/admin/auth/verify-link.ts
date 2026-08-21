import { parseJsonBody } from "../../../../_lib/validation";
import { verifyAdminMagicLink } from "../../../../_lib/auth/admin";
import { adminAuthVerifySchema } from "../../../../../assets/shared/schemas/admin-auth";
import type { AdminContext } from "../../../../_lib/db/context";
import type { DatabaseSessionLike } from "../../../../_lib/db/session";
import {
  createAdminSessionEstablishedResponse,
  prepareMagicLinkVerificationHttp,
} from "../../../../_lib/auth/http-flow";
import { dispatchPostOnly } from "../../../../_lib/http";

const ADMIN_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE = "admin-auth-verify-link:ip";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, adminAuthVerifySchema);
  const http = await prepareMagicLinkVerificationHttp(c, ADMIN_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE);
  const db = http.db as DatabaseSessionLike;

  const verified = await verifyAdminMagicLink(db, {
    token: body.token,
    sessionTtlHours: 8,
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
    auditAction: "admin_magic_link_verified",
  });

  return createAdminSessionEstablishedResponse({
    secret: http.secret,
    request: c.req.raw,
    admin: verified.admin,
    sessionId: verified.sessionId,
    expiresAt: verified.expiresAt,
    state: db.getBookmark?.(),
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
