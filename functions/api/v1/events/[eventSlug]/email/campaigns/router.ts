import { fromHono } from "chanfana";
import { Hono } from "hono";
import type { RequestDbContext } from "../../../../../../_lib/db/context";
import { EventEmailCampaignCreate } from "./index";
import { EventEmailCampaignPreviewCreate } from "./previews";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/previews", EventEmailCampaignPreviewCreate);
openapi.post("/", EventEmailCampaignCreate);

export default openapi;
