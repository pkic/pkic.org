import { Hono } from "hono";
import { fromHono } from "chanfana";
import attendees_Router from "./attendees/router";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/attendees", attendees_Router);

export default openapi;
