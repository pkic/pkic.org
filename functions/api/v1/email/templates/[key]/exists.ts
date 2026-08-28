import { json } from "../../../../../_lib/http";
import { templateKeyExists } from "../../../../../_lib/email/templates";
import type { AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  emailTemplateExistsResponseSchema,
  emailTemplateExistsRouteSchema,
} from "../../../../../../assets/shared/schemas/email-templates";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";

export const EmailTemplatesKeyExistsGet = openApiRoute(
  emailTemplateExistsRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffPermission(c, "email-templates:read");
    const exists = await templateKeyExists(db, data.params.key);
    return json(emailTemplateExistsResponseSchema.parse({ exists }));
  },
);
