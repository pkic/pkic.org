import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEventsEventSlugInvitesSpeakersBulkPost_l } from "./bulk";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.post("/bulk", AdminEventsEventSlugInvitesSpeakersBulkPost_l);

export default openapi;
