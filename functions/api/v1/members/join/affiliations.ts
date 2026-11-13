import { memberJoinAffiliationPreviewRouteSchema } from "../../../../../assets/shared/schemas/member-join";
import { identityAffiliationPreviewResponseSchema } from "../../../../../assets/shared/schemas/identity-affiliation";
import { resolveUserSessionFromRequest } from "../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { getClientIp } from "../../../../_lib/request";
import { previewMemberJoinAffiliation } from "../../../../_lib/services/membership/join/affiliation-preview";
import { normalizeEmail } from "../../../../_lib/validation";

export const MembersJoinAffiliationsPost = openApiRoute(
  memberJoinAffiliationPreviewRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const session = await resolveUserSessionFromRequest(db, c.req.raw, c.env);
    await enforceRateLimit({
      binding: c.env.IP_RATE_LIMITER,
      namespace: "membership-join-preview:ip",
      key: getClientIp(c.req.raw),
    });
    const preview = await previewMemberJoinAffiliation(db, {
      ...data.body,
      email: normalizeEmail(session.identity.email),
    });
    return jsonPrivate(identityAffiliationPreviewResponseSchema.parse(preview));
  },
);
