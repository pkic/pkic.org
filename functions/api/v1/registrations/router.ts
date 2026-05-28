import { Hono } from "hono";
import { fromHono } from "chanfana";
import manage_Router from "./manage/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/manage", manage_Router);

export default openapi;
