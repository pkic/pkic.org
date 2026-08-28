import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import calendar_Router from "./calendar/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/calendar", calendar_Router);

export default openapi;
