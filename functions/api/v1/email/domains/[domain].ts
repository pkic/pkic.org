import { emailDomainResponseSchema, emailDomainRouteSchema } from "../../../../../assets/shared/schemas/email-domains";
import type { AdminContext } from "../../../../_lib/db/context";
import { mailboxKind } from "../../../../_lib/email-domains/classification";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { getClientIp } from "../../../../_lib/request";

/**
 * GET /api/v1/email/domains/:domain — what kind of mailbox a domain is, so the
 * email-first step can steer a free address before anything is sent without
 * the browser downloading the lists. Public, so each network is rate limited.
 */
export const EmailDomainGet = openApiRoute(emailDomainRouteSchema, async (c: AdminContext, data) => {
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "email-domain-kind:ip",
    key: getClientIp(c.req.raw),
  });
  return json(emailDomainResponseSchema.parse({ domain: data.params.domain, kind: mailboxKind(data.params.domain) }));
});
