import { Hono } from "hono";
import { fromHono } from "chanfana";
import { handleError } from "../../../../../../_lib/http";
import { onRequestPatch as AdminSpeakerPatch } from "./[userId]";
import { onRequestPost as AdminSpeakerRemindPost } from "./[userId]/remind";
import { onRequestPost as AdminSpeakerRemindPresentationPost } from "./[userId]/remind-presentation";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

app.patch("/:userId", AdminSpeakerPatch);
app.post("/:userId/remind", AdminSpeakerRemindPost);
app.post("/:userId/remind-presentation", AdminSpeakerRemindPresentationPost);

export default openapi;
