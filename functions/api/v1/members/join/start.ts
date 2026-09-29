import { memberJoinStartRouteSchema } from "../../../../../assets/shared/schemas/member-join";
import { prepareMagicLinkRequestHttp } from "../../../../_lib/auth/http-flow";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { jsonNoStore } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { startMemberJoin } from "../../../../_lib/services/membership/join/start";
import type { AdminContext } from "../../../../_lib/db/context";

const RATE_LIMIT_NAMESPACE = "membership-join-start";

export const MembersJoinStartPost = openApiRoute(memberJoinStartRouteSchema, async (c: AdminContext, data) => {
  const http = await prepareMagicLinkRequestHttp(c, data.body.email, RATE_LIMIT_NAMESPACE);
  const result = await startMemberJoin(http.db, {
    email: data.body.email,
    unaffiliatedAttestation: data.body.unaffiliatedAttestation,
    ttlMinutes: http.magicLinkTtlMinutes,
    appBaseUrl: http.appBaseUrl,
  });
  if (result.outboxId) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(http.db, c.env, result.outboxId));
  }
  return jsonNoStore({ status: result.status });
});
