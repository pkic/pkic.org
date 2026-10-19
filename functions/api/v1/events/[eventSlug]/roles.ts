import { eventTeamRosterResponseSchema } from "../../../../../assets/shared/schemas/event-team";
import { eventTeamRosterRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-events";
import { requestDb } from "../../../../_lib/db/context";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../_lib/services/events";
import { listEventTeamRoster } from "../../../../_lib/services/events/team-roster";
import type { ValidatedData } from "chanfana";
import {
  eventTeamRoleCreateResponseSchema,
  eventTeamRolesResponseSchema,
} from "../../../../../assets/shared/schemas/event-team";
import {
  eventTeamRoleCreateRouteSchema,
  eventTeamRolesListRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-events";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { grantEventTeamRole, listEventTeam } from "../../../../_lib/services/events/team";
import { requireEventPermission } from "./authorization";

export const EventTeamRolesList = openApiRoute(eventTeamRolesListRouteSchema, async (c: AdminContext, data) => {
  const { actor, db } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
  return json(eventTeamRolesResponseSchema.parse(await listEventTeam(db, actor, data.params.eventSlug, data.query)));
});

export const EventTeamRoleCreate = openApiRoute(
  eventTeamRoleCreateRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof eventTeamRoleCreateRouteSchema>) => {
    const { actor, db } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
    const role = await grantEventTeamRole(db, actor, data.params.eventSlug, data.body);
    return json(eventTeamRoleCreateResponseSchema.parse({ role }), 201);
  },
);

export const EventTeamRosterList = openApiRoute(eventTeamRosterRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return json(eventTeamRosterResponseSchema.parse(await listEventTeamRoster(db, actor, event.id, data.query)));
});
