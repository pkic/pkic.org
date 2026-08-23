import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  adminEmailTemplateVersionCreateResponseSchema,
  emailTemplateVersionCreateRouteSchema,
  emailTemplateVersionsListRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-email-templates";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import {
  createAdminEmailTemplateVersion,
  listAdminEmailTemplateVersions,
} from "../../../../../_lib/services/admin-email-templates";
import type { ValidatedData } from "chanfana";

export const EmailTemplateVersionsList = openApiRoute(
  emailTemplateVersionsListRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

    return json(await listAdminEmailTemplateVersions(requestDb(c), data.params.key, data.query));
  },
);

async function handleVersionCreate(
  c: AdminContext,
  data: ValidatedData<typeof emailTemplateVersionCreateRouteSchema>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = data.body;

  const version = await createAdminEmailTemplateVersion(requestDb(c), admin, {
    templateKey: data.params.key,
    content: body.content,
    subjectTemplate: body.subjectTemplate,
    contentType: body.contentType,
    messageType: body.messageType,
  });

  return json(adminEmailTemplateVersionCreateResponseSchema.parse({ success: true, version }));
}

export const EmailTemplateVersionCreate = openApiRoute(emailTemplateVersionCreateRouteSchema, handleVersionCreate);
