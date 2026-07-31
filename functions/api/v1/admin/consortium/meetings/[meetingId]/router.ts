import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ConsortiumMeetingUpdate, ConsortiumMeetingDelete } from "./index";
import { ConsortiumMeetingResendPost } from "./resend";
import icsFiles_Router from "./ics-files/router";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.patch("/", ConsortiumMeetingUpdate);
openapi.delete("/", ConsortiumMeetingDelete);
openapi.post("/resend", ConsortiumMeetingResendPost);
openapi.route("/ics-files", icsFiles_Router);

export default openapi;
