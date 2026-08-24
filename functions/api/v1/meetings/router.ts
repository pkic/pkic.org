import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { MeetingJoinConfirm, MeetingJoinLanding } from "./join/[token]/index";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/join/:token", MeetingJoinLanding);
openapi.post("/join/:token", MeetingJoinConfirm);

export default openapi;
