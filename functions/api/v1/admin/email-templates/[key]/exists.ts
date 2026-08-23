import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { templateKeyExists } from "../../../../../_lib/email/templates";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  adminEmailTemplateExistsResponseSchema,
  emailTemplateExistsRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-email-templates";

export const AdminEmailTemplatesKeyExistsGet = openApiRoute(
  emailTemplateExistsRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const exists = await templateKeyExists(requestDb(c), data.params.key);
    return json(adminEmailTemplateExistsResponseSchema.parse({ exists }));
  },
);
