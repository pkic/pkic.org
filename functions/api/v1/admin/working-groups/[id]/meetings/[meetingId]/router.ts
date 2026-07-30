import { Hono } from "hono";
import { fromHono } from "chanfana";
import { WgMeetingUpdate, WgMeetingDelete } from "./index";
import { WgMeetingResendPost } from "./resend";
import icsFiles_Router from "./ics-files/router";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.patch("/", WgMeetingUpdate);
openapi.delete("/", WgMeetingDelete);
openapi.post("/resend", WgMeetingResendPost);
openapi.route("/ics-files", icsFiles_Router);

export default openapi;
