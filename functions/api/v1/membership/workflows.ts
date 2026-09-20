import { membershipWorkflowRemoveRouteSchema } from "../../../../assets/shared/schemas/membership-workflow-routes";
import { removeMembershipWorkflowVersion } from "../../../_lib/services/membership/workflows/removal";
import {
  membershipWorkflowDestinationsRouteSchema,
  membershipWorkflowDestinationRouteSchema,
} from "../../../../assets/shared/schemas/membership-workflow-routes";
import {
  listMembershipNoticeDestinations,
  getMembershipNoticeDestination,
} from "../../../_lib/services/membership/workflows/destinations";
import {
  membershipWorkflowCreateRouteSchema,
  membershipWorkflowGetRouteSchema,
  membershipWorkflowPublishRouteSchema,
  membershipWorkflowsListRouteSchema,
  membershipWorkflowUpdateRouteSchema,
} from "../../../../assets/shared/schemas/membership-workflow-routes";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  getMembershipWorkflowVersion,
  listMembershipWorkflowVersions,
} from "../../../_lib/services/membership/workflows/catalog";
import {
  createMembershipWorkflowDraft,
  updateMembershipWorkflowDraft,
} from "../../../_lib/services/membership/workflows/drafts";
import { publishMembershipWorkflow } from "../../../_lib/services/membership/workflows/publication";

export const MembershipWorkflowsList = openApiRoute(
  membershipWorkflowsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffPermission(c, "membership:read");
    return json(await listMembershipWorkflowVersions(db, data.query));
  },
);
export const MembershipWorkflowGet = openApiRoute(membershipWorkflowGetRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "membership:read");
  return json({ workflow: await getMembershipWorkflowVersion(db, data.params.versionId) });
});
export const MembershipWorkflowCreate = openApiRoute(
  membershipWorkflowCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:write");
    return json({ workflow: await createMembershipWorkflowDraft(db, staff, data.body) });
  },
);
export const MembershipWorkflowUpdate = openApiRoute(
  membershipWorkflowUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:write");
    return json({ workflow: await updateMembershipWorkflowDraft(db, staff, data.params.versionId, data.body) });
  },
);
export const MembershipWorkflowPublish = openApiRoute(
  membershipWorkflowPublishRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:write");
    return json({
      workflow: await publishMembershipWorkflow(
        db,
        staff,
        data.params.versionId,
        data.body,
        Boolean(c.env.STRIPE_SECRET_KEY),
      ),
    });
  },
);

export const MembershipWorkflowDestinations = openApiRoute(
  membershipWorkflowDestinationsRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:read");
    return json(await listMembershipNoticeDestinations(db, staff, data.query));
  },
);
export const MembershipWorkflowDestination = openApiRoute(
  membershipWorkflowDestinationRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffPermission(c, "membership:read");
    return json(await getMembershipNoticeDestination(db, data.params.destinationId));
  },
);

export const MembershipWorkflowRemove = openApiRoute(
  membershipWorkflowRemoveRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:write");
    return json(await removeMembershipWorkflowVersion(db, staff, data.params.versionId, data.body));
  },
);
