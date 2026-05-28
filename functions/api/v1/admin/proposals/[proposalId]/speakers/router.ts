import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPatch as AdminSpeakerPatch } from "./[userId]";
import { onRequestPost as AdminSpeakerRemindPost } from "./[userId]/remind";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.patch("/:userId", AdminSpeakerPatch);
app.post("/:userId/remind", AdminSpeakerRemindPost);

export default openapi;
