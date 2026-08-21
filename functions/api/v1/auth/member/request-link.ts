/**
 * POST /api/v1/auth/member/request-link.
 * Mirrors admin/auth/request-link.ts exactly, targeting active members
 * instead of staff (see functions/_lib/auth/member.ts).
 */
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requestMemberMagicLink } from "../../../../_lib/auth/member";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { logInfo } from "../../../../_lib/logging";
import { memberAuthRequestSchema } from "../../../../../assets/shared/schemas/member-auth";
import type { AdminContext } from "../../../../_lib/db/context";
import { prepareMagicLinkRequestHttp } from "../../../../_lib/auth/http-flow";
import { dispatchPostOnly } from "../../../../_lib/http";

const MEMBER_MAGIC_LINK_REQUEST_RATE_LIMIT_NAMESPACE = "member-auth-request-link";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, memberAuthRequestSchema);
  const http = await prepareMagicLinkRequestHttp(c, body.email, MEMBER_MAGIC_LINK_REQUEST_RATE_LIMIT_NAMESPACE);

  const magic = await requestMemberMagicLink(http.db, {
    email: body.email,
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
    ttlMinutes: http.magicLinkTtlMinutes,
  });

  if (magic.token && magic.member) {
    const magicLinkUrl = `${http.appBaseUrl}/portal/?token=${encodeURIComponent(magic.token)}`;
    const outboxId = await queueEmail(http.db, {
      templateKey: "member_magic_link",
      recipientEmail: magic.member.email,
      recipientUserId: null,
      messageType: "transactional",
      subject: "Your PKI Consortium member sign-in link",
      data: { email: magic.member.email, magicLinkUrl, expiresInMinutes: http.magicLinkTtlMinutes },
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(http.db, c.env, outboxId));
  } else {
    logInfo("member_magic_link_skipped", {
      reason: "No active member found for the requested email address.",
    });
  }

  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
