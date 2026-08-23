import { Hono } from "hono";
import { fromHono } from "chanfana";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { adminBulkAttendeeInvitesRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts";
import { onRequestPost as AdminEventsEventSlugInvitesAttendeesBulkPost_l } from "./bulk";
import { AdminEventsEventSlugInvitesAttendeesPreviewPost } from "./preview";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post(
  "/bulk",
  openApiRoute(adminBulkAttendeeInvitesRouteSchema, AdminEventsEventSlugInvitesAttendeesBulkPost_l),
);
openapi.post("/preview", AdminEventsEventSlugInvitesAttendeesPreviewPost);

export default openapi;
