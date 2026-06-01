import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as InvitesTokenAcceptPost_l } from "./accept";
import { onRequestGet as InvitesTokenDeclineInfoGet_l } from "./decline-info";
import { onRequestGet as InvitesTokenDeclineGet_l } from "./decline";
import { onRequestPost as InvitesTokenDeclinePost_l } from "./decline";
import { onRequestGet as InvitesTokenInfoGet_l } from "./info";
import { onRequestPost as InvitesTokenRemindersPost_l } from "./reminders";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/accept", InvitesTokenAcceptPost_l);
app.get("/decline-info", InvitesTokenDeclineInfoGet_l);
app.get("/decline", InvitesTokenDeclineGet_l);
app.post("/decline", InvitesTokenDeclinePost_l);
app.get("/info", InvitesTokenInfoGet_l);
app.post("/reminders", InvitesTokenRemindersPost_l);

export default openapi;
