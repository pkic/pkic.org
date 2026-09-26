import { openApiRoute } from "../../../../../_lib/openapi/route";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { getApplicantStatus } from "../../../../../_lib/services/membership/applications/status";
import { memberApplicationStatusRouteSchema } from "../../../../../../assets/shared/schemas/member-applications";

export const MembersApplicationsStatusGet = openApiRoute(
  memberApplicationStatusRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    return json(
      await getApplicantStatus(requestDb(c), data.params.id, data.query.token, c.env.INTERNAL_SIGNING_SECRET),
    );
  },
);
