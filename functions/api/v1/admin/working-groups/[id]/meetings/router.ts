import { Hono } from "hono";
import { fromHono } from "chanfana";
import { WgMeetingsGet, WgMeetingsCreate } from "./index";
import meetingId_Router from "./[meetingId]/router";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

// Access is gated by the parent working-groups/:id/ router's own
// middleware (../../router.ts's requireWorkingGroupAccess), which covers
// this whole /meetings/** subtree too — no per-router gate needed here.

openapi.get("/", WgMeetingsGet);
openapi.post("/", WgMeetingsCreate);
openapi.route("/:meetingId", meetingId_Router);

export default openapi;
