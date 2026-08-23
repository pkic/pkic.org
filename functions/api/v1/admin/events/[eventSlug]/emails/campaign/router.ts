import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEventsEventSlugEmailsCampaignPreviewPost } from "./preview";
import { AdminEventsEventSlugEmailsCampaignSendPost } from "./send";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/preview", AdminEventsEventSlugEmailsCampaignPreviewPost);
openapi.post("/send", AdminEventsEventSlugEmailsCampaignSendPost);

export default openapi;
