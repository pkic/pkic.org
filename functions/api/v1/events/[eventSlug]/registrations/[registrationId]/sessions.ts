import { registrationSessionsRouteSchema } from "../../../../../../../assets/shared/schemas/event-registration-sessions";
import { markResponseSensitive, type AdminContext } from "../../../../../../_lib/db/context";
import { jsonNoStore } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { listRegistrationSessionIntent } from "../../../../../../_lib/services/registrations/session-intent";
import { requireEventRegistrationManagement } from "../authorization";

export const EventRegistrationSessionsGet = openApiRoute(
  registrationSessionsRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event } = await requireEventRegistrationManagement(c, data.params.eventSlug);
    return jsonNoStore(await listRegistrationSessionIntent(db, event.id, data.params.registrationId, data.query));
  },
);
