import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEventsEventSlugInvitesAttendeesBulkPost_l } from "./bulk";
import { onRequestPost as AdminEventsEventSlugInvitesAttendeesPreviewPost_l } from "./preview";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.post("/bulk", AdminEventsEventSlugInvitesAttendeesBulkPost_l);
app.post("/preview", AdminEventsEventSlugInvitesAttendeesPreviewPost_l);

export default openapi;
