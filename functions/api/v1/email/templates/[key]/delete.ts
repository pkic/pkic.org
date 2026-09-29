import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { deleteEmailTemplate } from "../../../../../_lib/services/email-template-management";
import { emailTemplateDeleteRouteSchema } from "../../../../../../assets/shared/schemas/email-templates";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";

export const EmailTemplatesKeyDelete = openApiRoute(emailTemplateDeleteRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "email-templates:manage");
  await deleteEmailTemplate(db, staff, data.params.key);
  return json({ success: true });
});
