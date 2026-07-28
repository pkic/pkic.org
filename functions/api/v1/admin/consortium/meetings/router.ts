import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ConsortiumMeetingsGet, ConsortiumMeetingsCreate } from "./index";
import meetingId_Router from "./[meetingId]/router";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", ConsortiumMeetingsGet);
openapi.post("/", ConsortiumMeetingsCreate);
openapi.route("/:meetingId", meetingId_Router);

export default openapi;
