import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { leaveGroup } from "../../../../_lib/services/groups";
import { groupLeaveRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-groups";

export const GroupLeave = openApiRoute(groupLeaveRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  return json(
    await leaveGroup(db, data.params.groupId, {
      actorUserId: member.userId,
      targetUserId: member.userId,
      selection: data.body,
      actorType: "member",
    }),
  );
});
