import { Hono } from "hono";
import { fromHono } from "chanfana";
import r_Router from "./r/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/r", r_Router);

export default openapi;
