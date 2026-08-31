import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  getGroup,
  joinGroup,
  listGroupMemberships,
  listGroupParticipants,
  requireGroupManagement,
} from "../../../../../_lib/services/groups";
import {
  groupMemberAddRouteSchema,
  groupMembershipsListRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-groups";
import {
  groupMembershipsManagementListResponseSchema,
  groupMembershipsParticipantListResponseSchema,
} from "../../../../../../assets/shared/schemas/groups";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { requireGroupResourceContext } from "../../group-resource-context";

/**
 * One canonical membership listing for both scopes: an effective group
 * manager gets the full capacity roster, and a caller with only the
 * `participate` capability gets the privacy-reduced roster (no email,
 * category, source, or membership-capacity identifier) so ordinary
 * participants can see who else is in the group. Mirrors the manage-vs-audience
 * split `/api/v1/events` uses.
 */
export const GroupMembershipsList = openApiRoute(groupMembershipsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  if (context.capabilities.includes("manage")) {
    const { memberships, total } = await listGroupMemberships(db, context.group.id, data.query);
    return json(
      groupMembershipsManagementListResponseSchema.parse({
        memberships,
        page: buildPageInfo(data.query.limit, data.query.offset, total, memberships.length),
      }),
    );
  }
  if (context.capabilities.includes("participate")) {
    const { participants, total } = await listGroupParticipants(db, context.group.id, data.query);
    return json(
      groupMembershipsParticipantListResponseSchema.parse({
        memberships: participants,
        page: buildPageInfo(data.query.limit, data.query.offset, total, participants.length),
      }),
    );
  }
  throw new AppError(403, "GROUP_PARTICIPATION_REQUIRED", "An active membership capacity is required");
});

export const GroupMemberAdd = openApiRoute(groupMemberAddRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const group = await getGroup(db, data.params.groupId);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await requireGroupManagement(db, admin, group.id);
  return json(
    await joinGroup(db, group.id, {
      actorUserId: admin.id,
      actorDatabaseUserId: admin.identityType === "user" ? admin.id : null,
      targetUserId: data.params.userId,
      selection: data.body.capacitySelection,
      source: "staff",
      allowManaged: true,
      managementActor: admin,
    }),
  );
});
