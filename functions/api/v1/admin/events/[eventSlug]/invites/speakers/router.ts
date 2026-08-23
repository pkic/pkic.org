import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEventsEventSlugInvitesSpeakersBulkPost } from "./bulk";
import { AdminEventsEventSlugInvitesSpeakersPreviewPost } from "./preview";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/bulk", AdminEventsEventSlugInvitesSpeakersBulkPost);
openapi.post("/preview", AdminEventsEventSlugInvitesSpeakersPreviewPost);

export default openapi;
