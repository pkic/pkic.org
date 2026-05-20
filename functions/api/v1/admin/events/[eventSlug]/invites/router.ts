import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as AdminEventsEventSlugInvitesGet_l } from "./index";
import inviteId_Router from "./[inviteId]/router";
import attendees_Router from "./attendees/router";
import speakers_Router from "./speakers/router";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.get("/", AdminEventsEventSlugInvitesGet_l);
app.route("/:inviteId", inviteId_Router);
app.route("/attendees", attendees_Router);
app.route("/speakers", speakers_Router);

export default app;
