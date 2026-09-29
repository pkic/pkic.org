import {
  membershipWorkflowMigrationPreviewRouteSchema,
  membershipWorkflowMigrationRouteSchema,
} from "../../../../../../assets/shared/schemas/membership-workflow-migration";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  previewMembershipWorkflowMigration,
  migrateMembershipWorkflow,
} from "../../../../../_lib/services/membership/workflows/migration";
export const MembershipWorkflowMigrationPreview = openApiRoute(
  membershipWorkflowMigrationPreviewRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffPermission(c, "membership:approve");
    return json(await previewMembershipWorkflowMigration(db, data.params.id, data.query.versionId));
  },
  async (c: AdminContext) => {
    await requireStaffPermission(c, "membership:approve");
  },
);
export const MembershipWorkflowMigration = openApiRoute(
  membershipWorkflowMigrationRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:approve");
    return json(await migrateMembershipWorkflow(db, data.params.id, staff, data.body));
  },
);
