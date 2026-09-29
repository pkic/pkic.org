import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import {
  guardEventResourceManagementDatabase,
  requireEventResourceManagementContext,
  type EventResourceManagementCapability,
} from "../../../../../../_lib/services/event-series/management";
import { getEventById } from "../../../../../../_lib/services/events";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

/** Resolve and continuously guard one event through the selected group. */
export async function requireManagedGroupEventContext(
  c: AdminContext,
  groupId: string,
  eventId: string,
  capability: EventResourceManagementCapability = "manage",
) {
  const rawDb = requestDb(c);
  const groupContext = await requireGroupResourceContext(rawDb, c.req.raw, c.env, groupId);
  const actor = requireGroupManagementActor(groupContext);
  const eventContext = await requireEventResourceManagementContext(
    rawDb,
    actor,
    groupContext.group.id,
    eventId,
    capability,
  );
  const db = guardEventResourceManagementDatabase(rawDb, actor, eventContext, capability);
  return { actor, db, event: await getEventById(db, eventId), rawDb };
}
