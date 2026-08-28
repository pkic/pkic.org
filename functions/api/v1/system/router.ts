import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import accessControl_Router from "./access-control/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/access-control", accessControl_Router);

export default openapi;
