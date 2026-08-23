import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEventsEventSlugInvitesInviteIdResendPost_l } from "./resend";
import { AdminEventsEventSlugInvitesInviteIdRevokePost } from "./revoke";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.post("/resend", AdminEventsEventSlugInvitesInviteIdResendPost_l);
openapi.post("/revoke", AdminEventsEventSlugInvitesInviteIdRevokePost);

export default openapi;
