import { Hono } from "hono";
import { fromHono } from "chanfana";
import { WorkingGroupGet, WorkingGroupUpdate } from "./index";
import members_Router from "./members/router";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", WorkingGroupGet);
openapi.patch("/", WorkingGroupUpdate);
openapi.route("/members", members_Router);

export default openapi;
