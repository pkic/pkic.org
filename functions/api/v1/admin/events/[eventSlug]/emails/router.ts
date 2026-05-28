import { Hono } from "hono";
import { fromHono } from "chanfana";
import campaign_Router from "./campaign/router";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/campaign", campaign_Router);

export default openapi;
