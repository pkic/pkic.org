import { json } from "../../../_lib/http";
import type { AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listEmailTemplates } from "../../../_lib/services/email-template-management";
import { emailTemplatesListRouteSchema } from "../../../../assets/shared/schemas/email-templates";
import { requireSystemPermission } from "./authorization";

export const EmailTemplatesList = openApiRoute(emailTemplatesListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireSystemPermission(c, "email-templates:read");
  return json(await listEmailTemplates(db, data.query));
});
