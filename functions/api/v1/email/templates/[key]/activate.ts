import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { activateEmailTemplateVersion } from "../../../../../_lib/services/email-template-management";
import { emailTemplateActivateRouteSchema } from "../../../../../../assets/shared/schemas/email-templates";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";

export const EmailTemplatesKeyActivatePost = openApiRoute(
  emailTemplateActivateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "email-templates:write");
    await activateEmailTemplateVersion(db, staff, data.params.key, data.body.version);

    return json({ success: true });
  },
);
