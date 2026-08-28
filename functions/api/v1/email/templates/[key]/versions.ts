import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  emailTemplateVersionCreateResponseSchema,
  emailTemplateVersionCreateRouteSchema,
  emailTemplateVersionsListRouteSchema,
} from "../../../../../../assets/shared/schemas/email-templates";
import type { AdminContext } from "../../../../../_lib/db/context";
import {
  createEmailTemplateVersion,
  listEmailTemplateVersions,
} from "../../../../../_lib/services/email-template-management";
import type { ValidatedData } from "chanfana";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";

export const EmailTemplateVersionsList = openApiRoute(
  emailTemplateVersionsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffPermission(c, "email-templates:read");
    return json(await listEmailTemplateVersions(db, data.params.key, data.query));
  },
);

async function handleVersionCreate(
  c: AdminContext,
  data: ValidatedData<typeof emailTemplateVersionCreateRouteSchema>,
): Promise<Response> {
  const { db, staff } = await requireStaffPermission(c, "email-templates:write");
  const body = data.body;

  const version = await createEmailTemplateVersion(db, staff, {
    templateKey: data.params.key,
    content: body.content,
    subjectTemplate: body.subjectTemplate,
    contentType: body.contentType,
    messageType: body.messageType,
  });

  return json(emailTemplateVersionCreateResponseSchema.parse({ success: true, version }));
}

export const EmailTemplateVersionCreate = openApiRoute(emailTemplateVersionCreateRouteSchema, handleVersionCreate);
