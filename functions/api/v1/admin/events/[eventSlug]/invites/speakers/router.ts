import { Hono } from "hono";
import { fromHono } from "chanfana";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { adminBulkSpeakerInvitesRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts";
import { onRequestPost as AdminEventsEventSlugInvitesSpeakersBulkPost_l } from "./bulk";
import { AdminEventsEventSlugInvitesSpeakersPreviewPost } from "./preview";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/bulk", openApiRoute(adminBulkSpeakerInvitesRouteSchema, AdminEventsEventSlugInvitesSpeakersBulkPost_l));
openapi.post("/preview", AdminEventsEventSlugInvitesSpeakersPreviewPost);

export default openapi;
