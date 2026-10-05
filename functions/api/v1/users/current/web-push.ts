import { ownedWebPushDeviceRevokeRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-event-web-push";
import { requireIdentityFromRequest } from "../../../../_lib/auth/user-session";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { revokeOwnedWebPushDevice } from "../../../../_lib/services/event-participation/web-push-subscriptions";
import { participantSessionDatabase } from "../../../../_lib/services/event-participation/self-authorization";
import { jsonNoStore } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
export const OwnedWebPushDeviceRevokeDelete = openApiRoute(
  ownedWebPushDeviceRevokeRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    return jsonNoStore(
      await revokeOwnedWebPushDevice(
        participantSessionDatabase(db, actor.userId, actor.sessionId),
        actor.userId,
        data.params.deviceId,
      ),
    );
  },
);
