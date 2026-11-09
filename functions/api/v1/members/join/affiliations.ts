import { memberJoinAffiliationPreviewRouteSchema } from "../../../../../assets/shared/schemas/member-join";
import { identityAffiliationPreviewResponseSchema } from "../../../../../assets/shared/schemas/identity-affiliation";
import { prepareMagicLinkVerificationHttp } from "../../../../_lib/auth/http-flow";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { previewMemberJoinAffiliation } from "../../../../_lib/services/membership/join/affiliation-preview";
import type { AdminContext } from "../../../../_lib/db/context";

export const MembersJoinAffiliationsPost = openApiRoute(
  memberJoinAffiliationPreviewRouteSchema,
  async (c: AdminContext, data) => {
    const http = await prepareMagicLinkVerificationHttp(c, "membership-join-preview:ip");
    const preview = await previewMemberJoinAffiliation(http.db, { ...data.body, signingSecret: http.secret });
    return jsonPrivate(identityAffiliationPreviewResponseSchema.parse(preview));
  },
);
