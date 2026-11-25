/** The ticket each organization gets: the decisions that count, a test of the classifier, and an organizer's own. */
import {
  eventTicketOrganizationDecisionDeleteRouteSchema,
  eventTicketOrganizationDecisionPostRouteSchema,
  eventTicketOrganizationsGetRouteSchema,
  eventTicketOrganizationTrialRouteSchema,
} from "../../../../../assets/shared/schemas/event-ticket-organizations";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import {
  clearTicketOrganizationDecision,
  decideTicketOrganizations,
  listTicketOrganizations,
  testTicketOrganizations,
} from "../../../../_lib/services/event-tickets/organization-decisions";
import { requireEventPermission } from "./authorization";

const EventTicketOrganizationsGet = openApiRoute(
  eventTicketOrganizationsGetRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
    return json(await listTicketOrganizations(db, event, data.query));
  },
);

const EventTicketOrganizationTrialPost = openApiRoute(
  eventTicketOrganizationTrialRouteSchema,
  async (c: AdminContext, data) => {
    const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
    // Each test asks the model, so one organizer's tests share a budget; a batch costs one charge.
    await enforceRateLimit({
      binding: c.env.IP_RATE_LIMITER,
      namespace: "ticket-organization-trials:user",
      key: actor.id,
    });
    return json(await testTicketOrganizations(db, c.env, event, data.body));
  },
);

const EventTicketOrganizationDecisionPost = openApiRoute(
  eventTicketOrganizationDecisionPostRouteSchema,
  async (c: AdminContext, data) => {
    const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
    await decideTicketOrganizations(db, actor, event, data.body);
    return json({ success: true });
  },
);

const EventTicketOrganizationDecisionDelete = openApiRoute(
  eventTicketOrganizationDecisionDeleteRouteSchema,
  async (c: AdminContext, data) => {
    const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
    await clearTicketOrganizationDecision(db, actor, event, data.params.decisionId);
    return json({ success: true });
  },
);

type TicketOrganizationRouter = Pick<typeof import("./router").openapi, "get" | "post" | "delete">;

export function registerTicketOrganizationRoutes(openapi: TicketOrganizationRouter): void {
  openapi.get("/tickets/organizations", EventTicketOrganizationsGet);
  openapi.post("/tickets/organizations/trials", EventTicketOrganizationTrialPost);
  openapi.post("/tickets/organizations/decisions", EventTicketOrganizationDecisionPost);
  openapi.delete("/tickets/organizations/decisions/:decisionId", EventTicketOrganizationDecisionDelete);
}
