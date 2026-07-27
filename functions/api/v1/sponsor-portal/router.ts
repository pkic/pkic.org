import { Hono } from "hono";
import { fromHono } from "chanfana";
import events_Router from "./events/router";
import type { RequestDbContext } from "../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/events", events_Router);

export default openapi;
