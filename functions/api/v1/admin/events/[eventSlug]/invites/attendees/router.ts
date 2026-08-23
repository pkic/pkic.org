import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEventsEventSlugInvitesAttendeesBulkPost } from "./bulk";
import { AdminEventsEventSlugInvitesAttendeesPreviewPost } from "./preview";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/bulk", AdminEventsEventSlugInvitesAttendeesBulkPost);
openapi.post("/preview", AdminEventsEventSlugInvitesAttendeesPreviewPost);

export default openapi;
