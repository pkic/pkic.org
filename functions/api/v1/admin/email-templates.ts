import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listAdminEmailTemplates } from "../../../_lib/services/admin-email-templates";
import { emailTemplatesListRouteSchema } from "../../../../assets/shared/schemas/admin-email-templates";

export const EmailTemplatesList = openApiRoute(emailTemplatesListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  return json(
    await listAdminEmailTemplates(requestDb(c), {
      ...data.query,
      limit: data.query.limit ?? 50,
      offset: data.query.offset ?? 0,
    }),
  );
});
