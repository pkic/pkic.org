import {
  userParticipationResponseSchema,
  userParticipationRouteSchema,
} from "../../../../../assets/shared/schemas/user-participation";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getUserParticipation } from "../../../../_lib/services/user-participation";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireProfileReaderOrSubject } from "./member-profile-authorization";

export const UserParticipationGet = openApiRoute(userParticipationRouteSchema, async (c: AdminContext, data) => {
  // Group participation is community information: any member may read it,
  // and so may the person it is about, member or not.
  const { db } = await requireProfileReaderOrSubject(c, data.params.userId);
  return json(
    userParticipationResponseSchema.parse({
      participation: await getUserParticipation(db, data.params.userId),
    }),
  );
});
