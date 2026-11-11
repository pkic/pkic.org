import { fromHono } from "chanfana";
import { Hono } from "hono";
import type { RequestDbContext } from "../../../../../../_lib/db/context";
import { EventEmailCampaignCreate } from "./index";
import { EventEmailCampaignPreviewCreate } from "./previews";
import { SpeakerKitTestCreate } from "./speaker-kits";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/previews", EventEmailCampaignPreviewCreate);
openapi.post("/tests", SpeakerKitTestCreate);
openapi.post("/", EventEmailCampaignCreate);

export default openapi;
