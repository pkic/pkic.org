import { Hono } from "hono";
import { fromHono } from "chanfana";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { adminWaitlistPromotionRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts";
import { onRequestPost as AdminEventsEventSlugWaitlistPromotePost_l } from "./promote";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/promote", openApiRoute(adminWaitlistPromotionRouteSchema, AdminEventsEventSlugWaitlistPromotePost_l));

export default openapi;
