import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { archiveEmailTemplate } from "../../../../../_lib/services/email-template-management";
import { emailTemplateArchiveRouteSchema } from "../../../../../../assets/shared/schemas/email-templates";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";

export const EmailTemplatesKeyArchivePost = openApiRoute(
  emailTemplateArchiveRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "email-templates:manage");
    await archiveEmailTemplate(db, staff, data.params.key);
    return json({ success: true });
  },
);
