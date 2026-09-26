import {
  emailOutboxDetailRouteSchema,
  emailOutboxDetailResponseSchema,
} from "../../../../../assets/shared/schemas/email-outbox";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";
import { getEmailOutboxDetail } from "../../../../_lib/services/email-outbox/detail";

export const EmailOutboxDetailGet = openApiRoute(emailOutboxDetailRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "email:read");
  return json(emailOutboxDetailResponseSchema.parse(await getEmailOutboxDetail(db, data.params.id)));
});
