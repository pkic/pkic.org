import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEventsEventSlugInvitesInviteIdResendPost } from "./resend";
import { AdminEventsEventSlugInvitesInviteIdRevokePost } from "./revoke";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/resend", AdminEventsEventSlugInvitesInviteIdResendPost);
openapi.post("/revoke", AdminEventsEventSlugInvitesInviteIdRevokePost);

export default openapi;
