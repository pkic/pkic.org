import { json } from "../../../../_lib/http";
import type { AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";
import {
  REQUIRED_EMAIL_TEMPLATE_KEYS,
  readUnavailableRequiredEmailTemplates,
} from "../../../../_lib/email/required-templates";
import {
  emailTemplateRequirementsResponseSchema,
  emailTemplateRequirementsRouteSchema,
} from "../../../../../assets/shared/schemas/email-templates";

export const EmailTemplateRequirementsGet = openApiRoute(
  emailTemplateRequirementsRouteSchema,
  async (c: AdminContext) => {
    const { db } = await requireStaffPermission(c, "email-templates:read");
    return json(
      emailTemplateRequirementsResponseSchema.parse({
        requiredCount: REQUIRED_EMAIL_TEMPLATE_KEYS.length,
        unavailable: await readUnavailableRequiredEmailTemplates(db),
      }),
    );
  },
);
