import { Hono } from "hono";
import { fromHono } from "chanfana";
import { InviteAcceptPost } from "./accept";
import { InviteDeclineInfoGet } from "./decline-info";
import { InviteDeclineGet, InviteDeclinePost } from "./decline";
import { InviteInfoGet } from "./info";
import { InviteRemindersPost } from "./reminders";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/accept", InviteAcceptPost);
openapi.get("/decline-info", InviteDeclineInfoGet);
openapi.get("/decline", InviteDeclineGet);
openapi.post("/decline", InviteDeclinePost);
openapi.get("/info", InviteInfoGet);
openapi.post("/reminders", InviteRemindersPost);

export default openapi;
