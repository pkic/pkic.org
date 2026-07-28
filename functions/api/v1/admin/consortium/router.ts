import { Hono } from "hono";
import { fromHono } from "chanfana";
import meetings_Router from "./meetings/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/meetings", meetings_Router);

export default openapi;
