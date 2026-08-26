import { groupEventRegistrationConfigRouteSchema } from "../../../../../../../assets/shared/schemas/group-events";
import { eventFormsResponseSchema } from "../../../../../../../assets/shared/schemas/forms";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { getEventById } from "../../../../../../_lib/services/events";
import { getEventRegistrationConfiguration } from "../../../../../../_lib/services/events/registration-configuration";
import { getGroupEvent } from "../../../../../../_lib/services/events/group-read-model";
import { requireGroupResourceContext } from "../../../group-resource-context";
import { AppError } from "../../../../../../_lib/errors";

export const GroupEventRegistrationConfigGet = openApiRoute(
  groupEventRegistrationConfigRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const { event } = await getGroupEvent(db, context.viewer, context.group.id, data.params.eventId);
    if (!event.capabilities.includes("register")) {
      throw new AppError(403, "EVENT_REGISTRATION_ACCESS_REQUIRED", "Registration access is required");
    }
    const storedEvent = await getEventById(db, event.id);
    return json(
      eventFormsResponseSchema.parse(
        await getEventRegistrationConfiguration(db, storedEvent, "event_registration", "event_placement"),
      ),
    );
  },
);
