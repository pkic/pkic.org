import { Hono } from "hono";
import { fromHono } from "chanfana";
import { SponsorPortalAttendeesList } from "./index";
import { onRequestGet as exportHandler } from "./export";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.get("/export", exportHandler);
openapi.get("/", SponsorPortalAttendeesList);

export default openapi;
