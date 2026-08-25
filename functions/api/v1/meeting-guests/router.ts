import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { GuestMeetingJoinConfirm, GuestMeetingJoinLanding } from "./meetings/occurrences/[occurrenceId]/join";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/meetings/occurrences/:occurrenceId/join", GuestMeetingJoinLanding);
openapi.post("/meetings/occurrences/:occurrenceId/join", GuestMeetingJoinConfirm);

export default openapi;
