import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import {
  retentionDueListResponseSchema,
  retentionDueListRouteSchema,
} from "../../../../../assets/shared/schemas/retention";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listRetentionDueWork } from "../../../../_lib/services/retention-work";

export const RetentionDueList = openApiRoute(retentionDueListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "retention:read");
  const result = await listRetentionDueWork(db, data.query);
  return json(
    retentionDueListResponseSchema.parse({
      items: result.items,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.items.length),
    }),
  );
});
