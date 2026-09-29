import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { joinGroup } from "../../../../_lib/services/groups";
import { groupJoinRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-groups";

export const GroupJoin = openApiRoute(groupJoinRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  return json(
    await joinGroup(db, data.params.groupId, {
      actorUserId: member.userId,
      targetUserId: member.userId,
      selection: data.body.capacitySelection,
      source: "self_service",
      allowManaged: false,
    }),
  );
});
